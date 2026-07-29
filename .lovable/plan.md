
## Audit — what actually happened for Priyanka Lohar (INC-26-0043)

Confirmed against the DB:

- **PT package** `ba4ca486…` — status `pending_payment`, monthly (`sessions_total=0`, `expiry_date 2026-10-27`), price ₹18,000, trainer `641b8204…`. Never activated.
- **Invoice** `INV-INC-26-0054` — status `pending`, total ₹18,000, one line item `PT Package - The Ascent 90`.
- **Payment** `a0941984…` — was `completed`, then voided (`status=refunded`, `void_reason=wrong purchase packed sold`, `voided_at 05:00:38`). So the money side is already reversed.
- **Trainer commissions** — 3 rows still `pending / earned_unconfirmed` for the trainer (₹2,285.71 × 3). **Not reversed.**
- Package doesn't appear in "Personal Training Packages" because `fetchActiveMemberPackages` filters `status='active'` and this one is stuck at `pending_payment`.

**Root cause:** `void_payment` reverses cash, but there is no flow that cancels the parent invoice, cancels the pending PT package, or reverses the linked trainer commissions. `cancel_pending_pt_package` RPC exists but has no UI and is never called by `void_payment`. There is also no "Cancel Invoice" UI anywhere.

## Plan

### 1. One-time backfill for Priyanka
Call the existing `cancel_pending_pt_package('ba4ca486…','wrong_sale_backfill')` to release the package + commissions, then set invoice `INV-INC-26-0054` to `cancelled` with an audit note.

### 2. New RPC `cancel_invoice(_invoice_id uuid, _reason text)`
Single atomic entry point (owner/admin/manager only via `has_any_role`). It will:
- Guard: refuse if invoice already `cancelled` or `refunded`.
- Void every non-voided payment on the invoice via existing `void_payment(..., reason)`.
- For each `invoice_items.reference_type`:
  - `pt_package` → call `cancel_pending_pt_package` if status is `pending_payment`; if `active`, mark package `cancelled`, zero out `sessions_remaining`, and reverse pending `trainer_commissions` via existing `void_trainer_commission`.
  - `membership` → call existing `cancel_membership` with `reason`.
  - `pos_sale` / `product` → restore batch stock via existing stock helpers.
- Set `invoices.status='cancelled'`, append audit row (`audit_logs`).
- Emit `payment_lifecycle_events` entry.

### 3. Backend trigger safety net
Add trigger on `payments`: when a PT-linked payment moves to `refunded/voided`, if the invoice has no remaining live payments, mark the invoice `cancelled` and cascade to the PT package + commissions (same logic as the RPC, called via `PERFORM public.cancel_invoice(...)`). Prevents future Priyanka-style orphans.

### 4. UI — Cancel Invoice (Sheet, right-side drawer)
Locations (read-only display already exists):
- `src/pages/Invoices.tsx` row action menu
- `src/components/invoices/InvoiceDetailDrawer.tsx` header
- `src/pages/MemberProfile.tsx` → Invoices tab
- `src/pages/PTSessions.tsx` → Active Packages row action ("Cancel Package & Invoice")

New component `CancelInvoiceDrawer.tsx`:
- Shows invoice summary, linked package/membership, refund preview (which payments will be voided, which commissions reversed).
- Required "Reason" textarea.
- Confirm ("Cancel Invoice") calls the RPC, invalidates `['invoices']`, `['member-pt-packages']`, `['active-member-packages']`, `['trainer-commissions']`, `['payments']`.
- Success toast + audit-log line.
- Role gate via `can.cancelInvoice(roles)` in `permissions.ts` (owner/admin, manager for own branch).

Existing `CorrectInvoiceDrawer` (amount correction) stays as-is; new drawer handles full cancellation.

### 5. Fix "Personal Training Packages" visibility
`src/pages/PTSessions.tsx` "Active Packages" tab currently hides `pending_payment` rows. Add:
- Status filter chip (`Active / Pending Payment / Expired / Cancelled`).
- Yellow badge for pending-payment rows with a "Complete Payment" quick action linking to the invoice, and "Cancel" (calls new RPC).
- Extend `fetchActiveMemberPackages` with an optional `statuses` arg (default keeps current behaviour for other callers).

### 6. Files touched

```text
supabase/migrations/2026xxxx_cancel_invoice_rpc.sql   (new RPC + trigger + backfill)
src/services/invoiceService.ts                        (cancelInvoice wrapper)
src/services/ptService.ts                             (extend fetchActiveMemberPackages)
src/hooks/useInvoices.ts                              (useCancelInvoice mutation)
src/hooks/usePTPackages.ts                            (accept statuses filter)
src/components/invoices/CancelInvoiceDrawer.tsx       (new)
src/components/invoices/InvoiceDetailDrawer.tsx       (add Cancel button)
src/pages/Invoices.tsx                                (row action)
src/pages/MemberProfile.tsx                           (invoice tab action)
src/pages/PTSessions.tsx                              (status chip + row actions)
src/lib/auth/permissions.ts                           (can.cancelInvoice)
```

### 7. Verification
- Backfill Priyanka, confirm: package → `cancelled`, invoice → `cancelled`, 3 commissions → `reversed`.
- Manually create a fresh PT sale in test, void the payment, confirm trigger cascades.
- Open Invoices page as owner → Cancel a paid invoice → confirm payment `refunded`, commissions reversed, PT package `cancelled`, list refreshes.
- Confirm non-admin roles do NOT see the Cancel action.

### Notes / non-goals
- No change to `correct_invoice` behaviour or GST re-issuance.
- No new Razorpay refund automation — voiding a Razorpay-settled payment still requires manual gateway refund; the UI will surface a warning banner in that case.
- No schema change to `member_pt_packages` — reuses existing `pt_package_status` enum values (`cancelled`, `reversed`).
