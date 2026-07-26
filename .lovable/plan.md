
## Part A — Data backfill for the two wrong invoices (one-time)

Two `supabase--insert` transactions, each `BEGIN … COMMIT`, with re-read verification after.

### 1. Nida — INV-INC-26-0027 (Half-Yearly)
Target: subtotal ₹19,999, discount ₹1,999, tax ₹0, **total ₹18,000**, paid ₹18,000, status `paid`.
- `UPDATE invoices` → discount_amount=1999, total_amount=18000, amount_paid=18000, status='paid'
- `UPDATE invoice_items` → total_amount=18000 (unit_price stays 19999)
- `UPDATE memberships fec90a68…` → price_paid=18000, discount_amount=1999, discount_reason='Manual correction — INV-INC-26-0027 backfill'
- Existing ₹19,999 refunded cash row: **untouched** (audit trail)
- `INSERT INTO payments` → ₹18,000 cash, status `completed`, notes explain backfill

### 2. Aamil — INV-INC-26-0017 (Annual Founder's Pass)
Target: **₹25,000 inclusive of 5% GST**, paid ₹25,000, status `paid`.
- `UPDATE invoices` → subtotal 23809.52, tax_amount 1190.48, total_amount 25000, amount_paid 25000
- `UPDATE invoice_items` → unit_price 23809.52, tax_rate 5, tax_amount 1190.48, total_amount 25000
- `UPDATE memberships 83968829…` → price_paid=25000
- Existing UPI ₹25,900 completed row: **untouched**
- `INSERT INTO payments` → **−₹900 refund row**, method UPI, status `refunded`, notes "Excess collected on INV-INC-26-0017 — corrected to ₹25,000 inclusive". Net ledger = 25,900 − 900 = 25,000.

After each txn: re-read invoice + items + membership + payments and report totals back.

---

## Part B — Add a permanent "Correct Invoice" UI (fills the audited gap)

**Gap:** finance staff has no way to fix a wrongly entered invoice today. Only `voidPayment` + `recordPayment` RPCs exist — no invoice-line correction path. We built one-off SQL for the two cases above; this section makes it a first-class feature so it never needs a developer again.

### B1. Server: atomic `correct_invoice` RPC (migration)
New `public.correct_invoice(p_invoice_id uuid, p_new_subtotal numeric, p_new_discount numeric, p_new_tax_rate numeric, p_new_total numeric, p_reason text, p_settlement text)` — `security definer`, gated by `has_capability(auth.uid(),'finance.manage')` (owner/admin/manager only, no staff).

Inside one transaction:
1. Snapshot old invoice + items + linked membership/PT into `audit_logs` with a `correction_before` payload.
2. Update `invoices` (subtotal / discount_amount / tax_amount / total_amount) — recompute `amount_paid` untouched, then recompute `status` from paid vs new total (paid / partial / pending).
3. Update the single line item to match new totals (only supports single-line invoices for v1; multi-line invoices show a warning and disable the drawer — safer scope).
4. If invoice is linked to a membership (`invoice_items.reference_type='membership'`), mirror new discount + `price_paid = new_total` on that membership row.
5. If invoice is linked to a PT package (`reference_type='pt_package'`), mirror to `member_pt_packages.amount_paid`.
6. Settlement handling based on `p_settlement`:
   - `'auto_refund'` → if new_total < amount_paid, insert a `payments` refund row for the delta (method inherited from the last completed payment on this invoice).
   - `'wallet_credit'` → credit the delta to the member's wallet via existing wallet service pattern.
   - `'due'` → if new_total > amount_paid, leave status as `partial`/`pending` (no auto payment created).
   - `'none'` → leave payments alone (dev backfill mode; guarded to owner-only).
7. Write a second `audit_logs` row with `correction_after`.

Return `{success, invoice_id, new_status, delta, settlement_action}`.

Guardrails: block if invoice_number is on a legally-issued GST invoice past the current GST filing month (org setting `gst_lock_month`) — force credit-note flow instead (documented, not implemented in v1).

### B2. Client: `CorrectInvoiceDrawer.tsx`
Right-side Sheet (per project rule), width `sm:max-w-lg`, opened from a new "Correct amount" action in `InvoiceViewDrawer.tsx` (visible only when `can.finance.manage`).

Fields:
- Current invoice snapshot (read-only strip: number, current total, paid, status).
- Correction reason (required, min 8 chars, saved to audit).
- New subtotal (₹, tax-exclusive)
- Include GST toggle → GST % select (uses `useGstRates()`, default 5% for this org) → inclusive/exclusive toggle.
- New discount (₹).
- **Live preview card** showing: subtotal, discount, tax, **new total**, delta vs current paid, and what will happen ("₹900 UPI refund will be recorded" / "₹500 wallet credit will be issued" / "₹200 will remain as pending dues").
- Settlement radio: **Refund to original method** · **Credit to wallet** · **Leave as dues** (only choices whose math is valid are enabled).
- Submit disabled until reason + total change validated.

Uses TanStack Query mutation → `supabase.rpc('correct_invoice', …)` → invalidates `['invoices']`, `['member-invoices', memberId]`, `['payments']`, `['memberships']`.

### B3. Access
- Owner + Admin + Manager (branch-scoped) see the "Correct amount" button.
- Staff never sees it.
- Every correction shows up in `audit_logs` and in a new "Correction history" section inside `InvoiceViewDrawer` so any past change is visible to whoever opens the invoice next.

### B4. Multi-line invoice safety (v1 scope)
For invoices with >1 line item (manual invoices with multiple products), show a banner "Multi-line invoice — please issue a credit note instead" and disable the correct button. Keeps the RPC contract simple; can be extended later.

---

## Order of execution
1. Run the two backfill SQL transactions (Part A). Confirm totals to you.
2. Ship migration for `correct_invoice` RPC + `has_capability` gate (Part B1).
3. Build `CorrectInvoiceDrawer.tsx` + wire it into `InvoiceViewDrawer.tsx` + "Correction history" strip (Part B2/B3/B4).

## Not touched
- No changes to `record_payment` / `void_payment` RPCs.
- No changes to MIPS, WhatsApp, receipts. Say the word if you want a corrected PDF re-sent to the member after backfill.
- No mass "edit any invoice field" UI — corrections are gated to amounts + discount + tax only, with mandatory reason and audit trail.
