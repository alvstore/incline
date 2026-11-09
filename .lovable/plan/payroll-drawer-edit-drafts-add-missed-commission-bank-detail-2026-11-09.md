# Payroll drawer: edit drafts, add missed commission, bank details

## What the audit found
- **Editing a draft already works, but is hidden.** The salary drawer lets you change salary, overtime, "Bonus / extra commission" and deductions while the slip is Draft — but the fields look like a read-only summary and there is no clear "Edit" step or explanation.
- **Sahil Sachdev's ₹5,000 is missing for a reason.** His PT package with Bhagirath was sold on 4 Nov, so the system schedules that commission into November's pay, not October's. Nothing is "lost" — it just isn't in this month yet. Today the only way to pay it early is typing it into Bonus, which risks paying it twice when November comes.
- **Bank details were never captured at onboarding.** None of the 10 trainers (and no staff) have a bank account saved anywhere — the trainer/staff onboarding forms have no bank fields at all. That's why the drawer asks every time.
- After you pay ₹78,166.67 it must be recorded once, matching what went out.

## What I'll build
1. **Clear draft editing**
   - "Edit" button on Draft/Approved slips that unlocks the amounts, with a live "Net payout" total and a required reason.
   - Paid slips stay locked (corrections stay separate, as designed).

2. **"Add missed commission" in the drawer**
   - Lists this trainer's PT commissions due in *future* months (e.g. Sahil Sachdev – ₹5,000 – due Nov).
   - Tick it to "Pay now in this slip": that commission moves into this slip and is marked settled, so November won't pay it again.
   - For anything not in the system (true one-off), keep "Bonus / extra commission" with a reason.

3. **Bank details done properly**
   - Add Bank name, Account number, IFSC (and optional UPI ID) to the trainer and staff profile/onboarding drawers.
   - Payroll drawer shows saved details read-only with a pencil "Edit" icon; editing saves back to the person's profile (audited), so next month it's pre-filled.
   - Account number shown masked (•••• 1234); only owner/admin/manager can see or change it.
   - Cash/UPI payments don't require bank details.

4. **Your Bhagirath payment** — after this ships, you open his slip, tick Sahil's ₹5,000, preview (₹78,166.67), and record the payment once with the bank reference. I won't record it for you without your go-ahead.

## Accessibility & design
- Side drawer only, labelled inputs, 44px buttons, status shown with text not just colour, works on tablet/phone (you're at 834px).

## Technical details
- New RPC `payroll_pull_forward_installments(p_item_id, p_installment_ids, p_reason)`: branch-guarded (`rpc_guard_applies` + `assert_branch_staff`), only for draft/approved items, only installments of the same trainer with status unpaid; re-dates payout month to the slip month and adds them to `prepared_installment_ids`; writes `payroll_audit`. Extend `payroll_item_pt_breakdown` (or new read RPC) to return future-due rows flagged `future`.
- Bank edit reuses `payroll_save_bank` (verify it writes to trainers/employees and audits); add bank fields to trainer/employee edit drawers; optional `upi_id` column (additive, nullable).
- Tests: pull-forward cannot double-settle; paid slips reject edits; bank validation (IFSC regex).
- No feature flag (UI clarity change; the server rules gate the money logic).
