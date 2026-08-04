# Reconciliation findings: make them accurate, self-clearing and real-time

## What's actually wrong

INV-INC-26-0017 is **correctly reconciled today**, but the checker still flags it. Verified against live data:

- Invoice records `amount_paid` = ₹25,000, `total_amount` = ₹25,000.
- Payments on it: ₹25,900 (completed) + ₹900 reversal row (status `refunded`, `reversal_of` pointing at the ₹25,900 payment, note: "Backfill: ₹900 UPI refund for excess collected").
- The daily check `reconcile_payments_daily()` sums **only** payments with status `completed` and ignores reversal rows, so it computes ₹25,900 vs ₹25,000 → a phantom ₹900 drift.

Three further gaps:

1. **Nothing ever clears a finding.** The function only inserts. A fixed invoice keeps producing a new row every night — hence "repeated 8×" for the same corrected invoice. Nothing sets `resolved_at`.
2. **The card's wording is wrong.** It says "linked items sum to ₹25,900", but `invoice_drift` compares the **payment ledger**, not line items. There is currently no line-item or GST check at all — so genuine GST/line-item errors go undetected.
3. **It's daily, not live.** Findings only appear (and only ever stack up) when the nightly cron runs, so a correction made today still shows as open until — never.

## What will be built

### 1. Correct the drift maths (netting reversals)

Rewrite `reconcile_payments_daily()` so the "actual paid" per invoice is:

```text
sum(completed payments)  -  sum(reversal rows that point at a payment on this invoice)
```

Standalone `refunded` payments (no `reversal_of`) keep being excluded entirely, as today.

### 2. Add the missing invoice integrity checks

Two new finding kinds, so the card really does catch amount and GST errors:

- `invoice_items_drift` — `invoices.total_amount` vs `sum(invoice_items.total_amount)`.
- `invoice_tax_drift` — `invoices.tax_amount` vs `sum(invoice_items.tax_amount)`, plus a per-line sanity check that `tax_amount ≈ unit_price × quantity × tax_rate` (catches the 18% vs 5% class of error).

### 3. Auto-resolve — findings become live state, not an append-only log

- Add an `auto_resolve_reconciliation_findings()` routine: for every open finding, recompute the check for that exact reference and stamp `resolved_at` + `resolution = 'auto'` when the discrepancy is gone.
- Replace blind inserts with an upsert keyed on `(kind, reference_type, reference_id)` while unresolved, and bump an `occurrence_count` / `last_seen_at` instead of creating a duplicate row per day. That removes the "repeated 8×" pile-up.
- Run the auto-resolve pass at the start of every reconciliation run, and expose it as a callable so it can run on demand.

### 4. Make it real-time per invoice

- Add a lightweight `recheck_invoice_reconciliation(invoice_id)` RPC that runs all three invoice checks for a single invoice and inserts/resolves accordingly.
- Fire it from the existing invoice mutation paths (`record_payment`, `reverse_payment`, `correct_invoice`, `cancel_invoice`, invoice item edits) via a deferred trigger, so a correction clears the finding within the same transaction — no waiting for the nightly job.
- Add `reconciliation_findings` to the realtime publication and subscribe in the System Health card so the count updates without a refresh.

### 5. Card UX fixes

- Correct copy per kind: payment-ledger drift vs line-item drift vs GST drift, each with its own explanation and the exact invoice figures.
- Show `last_seen_at` and occurrence count from the row rather than client-side grouping.
- Keep the deep link to the invoice, and add a "Re-check now" action per finding that calls the single-invoice RPC and refreshes.

### 6. Clear the current backlog

Run the corrected checker once so the 8 stale rows for INV-INC-26-0017 resolve themselves, and confirm the card reads "All ledgers reconciled" unless a real discrepancy exists.

## Technical notes

- Migration: rewrite `reconcile_payments_daily()`, add `recheck_invoice_reconciliation(uuid)`, `auto_resolve_reconciliation_findings()`, add `occurrence_count`, `last_seen_at`, `resolution` columns and a partial unique index on `(kind, reference_type, reference_id) WHERE resolved_at IS NULL` to `reconciliation_findings`, plus the deferred trigger on `invoices` / `invoice_items` / `payments`.
- All functions stay `SECURITY DEFINER` with `SET search_path = public`, matching existing conventions.
- Frontend: `src/components/system/ReconciliationFindingsCard.tsx` only — kind-aware copy, realtime subscription, per-row re-check.
- Tolerance stays at ₹0.01 to avoid float noise.
