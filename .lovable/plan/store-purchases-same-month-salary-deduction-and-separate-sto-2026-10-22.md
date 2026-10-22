# Store purchases: same-month salary deduction and separate store bill numbers

## What I found
1. **Salary deduction timing is not tied to the month today.** Store purchases on "Deduct from salary" are saved as staff advances. Payroll recovers *all* open advances whenever the next payroll is generated, and the HR setting "maximum advance recovery per month" can split them across months. So an October purchase can be recovered in October, November or partly in each. A November purchase made before October payroll is generated would wrongly be taken from October.
2. **Store bills share numbers with membership bills.** Counter sales create a record in the same invoice list. Because no GST is set up, they take the next number in the same **BOS-INC-26-xxxx** series as membership bills, such as BOS-INC-26-0122 for Krishna. So store and membership bills are mixed in one number sequence. The only difference in the Invoices list is a small "POS" tag. They are also counted together in revenue totals.

## What I'll change
### 1. Same-month salary deduction
- A store purchase made in a month is deducted **in full from that month's salary**. October purchases come off October pay, even if the monthly advance cap would normally spread them out.
- Ordinary cash advances keep their current rules, including the cap.
- Purchases from a later month are left out of an earlier month's payroll.
- If that month's payroll has already been finalised when the purchase is made, the amount moves to the next month and is labelled "Carried from Oct".
- The payslip and payroll review show a separate **"Store purchases"** line with invoice numbers, separate from "Advance recovery".

### 2. Separate store bill numbers
- New counter sales get their own series: **POS-INC-26-0001, 0002…**. Membership BOS and INV numbers are no longer used up by store sales.
- These are internal sale records only: no GST, not tax invoices. The printed receipt says "Store receipt".
- **Invoices page:** a filter with **All / Memberships & services / Store**. Store records keep the POS tag and can be opened as before.
- **Finance overview and revenue:** store sales appear as their own "Store" line instead of being mixed into membership income.
- **Member dues:** store dues are shown separately from membership dues. They still never block gate entry, which is the existing rule.
- Existing bills keep their numbers. Today there are no store bills in the list, so nothing needs renumbering.

## Technical details
- `salary_advances`: add `source text default 'manual'` and `recover_in_month date`; `create_pos_sale_audited` sets `source='pos'` and `recover_in_month = date_trunc('month', IST today)`. If that month's `payroll_runs` row is finalised, use the next month and set the carry flag.
- `payroll_advance_due`: add a period argument. POS advances are included only when `recover_in_month <= period month`, uncapped. Manual advances keep the cap.
- Payroll item gains `final_store_deduction` (nullable, default 0), shown in the payroll review, the preview drawer and the payslip. `apply_advance_recovery` closes POS rows for that period first.
- `generate_invoice_number(_for)`: series `POS` when `NEW.pos_sale_id IS NOT NULL OR NEW.source = 'pos'`, with its own counter row. `create_pos_sale` already inserts `source='pos'`.
- Invoices page filter on `source`/`pos_sale_id`; finance and revenue RPCs split by source; member dues summary splits store and membership.
- Tests:
  - an October purchase recovers in the October period and not in September;
  - a purchase after October is finalised carries to November;
  - an advance cap doesn't defer store purchases;
  - a store sale gets a POS- number while the next membership bill continues its own BOS sequence.
