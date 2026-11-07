# Fix false "Payment ledger mismatch" and "Stalled membership" alerts

## What I found
- **Store bills POS-0004, 0005, 0006** (cash/UPI): the store checkout marks the bill paid but never writes a matching payment receipt, so the daily money check sees ₹0 received. The money was taken; only the receipt row is missing.
- **POS-0001 (Gyaneshwar, ₹580)**: settled by salary deduction. No cash came in, so there should be no receipt — the check should accept the linked salary deduction instead of flagging it.
- **INV-INC-26-0188 (₹25,000 Founder's Pass)**: paid by card, and the membership is set to start on **11 Nov 2026**. "Pending" is correct — it activates on its start date. The check wrongly treats future-dated memberships as stalled.

## Changes
1. **Store checkout writes a receipt**: cash/card/UPI store sales record one completed payment through the existing payment path, linked to the bill. Salary-deduction and "due" sales stay without a receipt.
2. **Backfill**: add the missing receipts for POS-0004 (₹480 cash), POS-0005 (₹1,650 cash), POS-0006 (₹1,100 UPI) using the original sale date and method. No bill totals change; stock is untouched.
3. **Daily check rules**:
   - Ledger mismatch skips bills settled by salary deduction that have a linked salary deduction for the same amount.
   - Stalled activation only flags pending memberships whose start date is today or earlier.
4. Re-run the check; all five alerts should close automatically.
5. Small tests: store cash sale creates exactly one receipt; salary-deduction sale creates none and is not flagged; future-dated paid membership is not flagged.

## Technical details
- Migration updating `create_pos_sale` (insert into `payments` for settled non-salary sales, idempotent per invoice) and `reconcile_payments_daily` (ledger exclusion via `pos_sales.salary_advance_id`; stalled predicate adds `m.start_date <= (now() at time zone 'Asia/Kolkata')::date`).
- Backfill via a guarded insert (only where no payment exists for the invoice).
- Re-run with the existing re-check action; confirm findings resolved.
