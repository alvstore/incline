
# Hardened Personal Training Financial Pipeline

## Goal

Replace the current best-effort PT purchase flow (two competing `purchase_pt_package` RPCs, optimistic frontend status, commissions sometimes computed off `price_paid` including GST) with a single atomic backend pipeline where:

- PT packages are created in a **`pending_payment`** state and only flip to `active` after a verified settlement.
- GST is **mandatory at 5%** (configurable but enforced), and **trainer commission is computed strictly off the pre-tax base**.
- Stale `pending_payment` rows, orphan invoices, and ghost commissions are cleaned up automatically by a scheduled job.
- The checkout UI is resilient against double-submit, refresh, and payment-gateway timeouts via stable idempotency + server polling.

## Current state (so the change is concrete)

- Two overloaded `purchase_pt_package` RPCs exist (4-arg payment-link path + 10-arg in-person path). They diverge on commission math and lifecycle.
- `member_pt_packages.status` enum is `active | expired | exhausted | cancelled` — no pending state exists; the 10-arg RPC writes `'pending'` which is not a valid enum label.
- `PurchasePTPackageDrawer` uses the 4-arg RPC and redirects to `/member/pay?invoice=...`, but nothing reverses the row if the member never pays.
- `reverse_trainer_commission` exists but no cron sweeps stale PT purchases.
- `gst_percentage` defaults to 18 on `pt_packages`; PT in this org should be 5%.

## Epic 1 — ACID database ledger + single allocation RPC

1. **Lifecycle states**
   - `ALTER TYPE pt_package_status ADD VALUE 'pending_payment' BEFORE 'active'`.
   - Add `ADD VALUE 'reversed'` for auto-cancelled stale rows (keeps audit trail distinct from staff-cancelled).
2. **Schema additions on `member_pt_packages`**
   - `payment_status text NOT NULL DEFAULT 'unpaid'` (`unpaid | paid | refunded`).
   - `idempotency_key text UNIQUE` (replaces fuzzy `notes ILIKE`).
   - `invoice_id uuid REFERENCES invoices(id)` (hard FK, not via `invoice_items.reference_id`).
   - `expires_pending_at timestamptz` set to `now() + interval '30 min'` when created.
   - Partial index `(status) WHERE status = 'pending_payment'` for the sweeper.
3. **Drop the 4-arg overload.** Replace with a single canonical RPC:
   ```
   purchase_pt_package(
     _member_id, _package_id, _trainer_id, _branch_id,
     _price_paid numeric,            -- gross total charged to member
     _gst_rate numeric DEFAULT 5,    -- mandatory, validated 0..28
     _payment_method text DEFAULT 'cash',
     _payment_source text DEFAULT 'in_person',  -- 'in_person' | 'payment_link'
     _idempotency_key text,
     _received_by uuid DEFAULT auth.uid()
   ) RETURNS jsonb
   ```
   Behavior, all in one transaction:
   - Idempotency: short-circuit on existing `idempotency_key`.
   - Compute `subtotal = round(price / (1 + gst/100), 2)`, `tax = price - subtotal`. **Commission always = `subtotal * trainer.pt_share_percentage / 100`**, never on gross.
   - Insert `member_pt_packages` with `status = 'pending_payment'`, `payment_status = 'unpaid'`, `expires_pending_at = now() + '30 min'`.
   - Insert `invoices` (`status = pending`, `invoice_type = 'pt_package'`) and link bi-directionally.
   - Insert `trainer_commissions` rows with `status = 'pending'` and `release_date` (or monthly schedule for duration packs) — **but tagged `kind='earned_unconfirmed'`** so reporting excludes them until settlement.
   - For `_payment_source = 'in_person'`: immediately call `settle_payment(...)` and (on success) call the activation helper below.
   - For `_payment_source = 'payment_link'`: return the invoice for the member to pay; activation happens via Epic 2.

4. **Activation helper** `activate_pt_package(_member_package_id, _payment_id)` — promotes `status='active'`, `payment_status='paid'`, flips commissions to `kind='earned'`, and inserts an `audit_log` row. Only callable by the payment webhook / `settle_payment` trigger (SECURITY DEFINER, internal).

5. **Backfill / migration safety**: any existing `member_pt_packages` rows stay `active`; only new rows use the new lifecycle. The 4-arg overload is dropped after the drawer is migrated in Epic 3.

## Epic 2 — Payment verification

1. **Razorpay/PayU webhook hook** (`payment-webhook` edge fn): when a `payment_link` for an `invoice_type='pt_package'` settles, look up `member_pt_packages.invoice_id` and call `activate_pt_package`. Failed/expired payments leave the row untouched for Epic 4 to sweep.
2. **Settle trigger**: `trg_after_payment_completed` on `payments` already exists for reversals — extend it (or add a sibling AFTER INSERT trigger) so any successful `payments` row whose invoice is `pt_package` invokes `activate_pt_package`. This makes the in-person path self-activating, no extra client call.
3. **Member checkout polling**: `/member/pay` already exists; add a query that polls `member_pt_packages.status` every 3s while the gateway redirect is pending, so the UI flips to "Package activated" without a manual refresh.

## Epic 3 — Resilient frontend checkout

In `src/components/pt/PurchasePTPackageDrawer.tsx` and `src/services/ptService.ts`:

1. **Single RPC call.** Remove the 4-arg invocation. Always pass `_gst_rate: 5` from the drawer (UI displays "GST 5% (mandatory)" — the `chargeGst` toggle and `gst_percentage` per-package field stay hidden for PT, source of truth is the RPC default).
2. **Stable idempotency.** Use the existing `useStableIdempotencyKey(memberId, 'pt-purchase', selectedPackageId|'custom')` instead of `pt-${memberId}-${packageId}-${Date.now()}`, so a retried/double-clicked submit hits the idempotent branch.
3. **Submit button state machine**: `idle → submitting → awaiting_payment → settled | failed`. Disable the button entirely during `submitting`; show inline spinner; on `awaiting_payment` show "Waiting for payment…" with a Cancel-and-reverse action (calls a new `cancel_pending_pt_package` RPC).
4. **Live breakdown panel** uses `computePtCheckout({ price, gstPct: 5, gstInclusive: true })` so staff sees: Subtotal (pre-GST), GST @5%, Total, **Commission preview** (`subtotal * pt_share_percentage`).
5. **Custom-pack path**: insert the `pt_packages` row with `gst_percentage = 5, gst_inclusive = true` to keep the catalog consistent.
6. **Error toasts** surface the RPC's `error` field verbatim instead of swallowing — staff need to know if the package was rejected vs. payment failed.

## Epic 4 — Automated reversal of stale transactions

1. **RPC** `reverse_stale_pt_purchases()` — for every `member_pt_packages` where `status='pending_payment'` AND `expires_pending_at < now()`:
   - Set `status='reversed'`, `payment_status='refunded'` (no money moved, but keeps semantics).
   - Void the invoice (`status='cancelled'`).
   - Call existing `void_trainer_commission` for each linked unconfirmed commission row.
   - Insert `audit_log` entry `pt_package.auto_reversed` with reason `payment_timeout`.
   - Insert `communication_logs` via `dispatch-communication` to optionally nudge member (gated by a `settings` flag, default off so we don't spam).
2. **Cron**: `pg_cron` job `reverse-stale-pt-purchases` every 10 minutes, registered via `supabase--insert` (not migration — contains project-specific URL/anon key per project convention).
3. **Manual override**: surface the same RPC behind a "Cancel & reverse" button on the awaiting-payment state in the drawer (covers the 30-min wait when staff want to retry immediately).
4. **Observability**: every reversal goes through `log_error_event` only on actual failure; successful reversals are counted in a new `SystemHealth` widget "Stale PT purchases reversed (24h)".

## Technical details

- **Mandatory GST enforcement**: `purchase_pt_package` raises if `_gst_rate NOT IN (0, 5)` (0 reserved for GST-exempt edge cases approved by Owner). The drawer never sends 0.
- **Commission math contract**: `commission_amount = round(subtotal * trainer.pt_share_percentage / 100, 2)`. Documented inline in the RPC and asserted by a unit test on `computePtCheckout` to ensure UI preview = server result.
- **Idempotency key shape**: `pt-purchase:{memberId}:{packageId|customDraftId}` — stable across retries within a draft, fresh per new draft.
- **Audit trail**: all state transitions write `audit_log` entries with `target_type='member_pt_package'` so the existing Audit Log UI surfaces the lifecycle.
- **Tests**:
  - `supabase/tests/rls/pt_purchase_lifecycle.sql` — happy path, idempotent retry, stale reversal, in-person vs link.
  - Vitest on `computePtCheckout` for the 5% inclusive case.
- **Memory update**: add a Core line to `mem://index.md` — "PT purchases use atomic `purchase_pt_package` RPC: pending_payment → active via payment verification; commission off pre-GST subtotal at mandatory 5%; stale rows auto-reversed every 10 min."

## Files touched

- New migration: lifecycle enum values, schema additions, replacement RPC, `activate_pt_package`, `cancel_pending_pt_package`, `reverse_stale_pt_purchases`, payment trigger.
- `supabase/functions/payment-webhook/index.ts` — call `activate_pt_package` on PT invoices.
- `supabase--insert` cron registration for the sweeper.
- `src/services/ptService.ts` — drop legacy args, expose single typed call.
- `src/components/pt/PurchasePTPackageDrawer.tsx` — stable idempotency, mandatory 5% GST UI, awaiting-payment state, cancel-and-reverse.
- `src/pages/MemberCheckout.tsx` (or `/member/pay`) — poll package status post-redirect.
- `src/pages/SystemHealth.tsx` — stale-reversal counter.
- `mem://index.md` — new Core line.

## Out of scope

- Refund of already-paid PT packages (separate flow via existing `reverse_payment`).
- Changing trainer commission percentages or approval workflow.
- Re-pricing existing active packages.
