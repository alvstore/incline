# POS: staff purchases, manual discount with audit, and product search fix

## What I found
- **Glutamine is in stock and sellable** ("Muscletech™ Platinum Glutamine", ₹1,499, 3 in stock). Some searches still miss it: the ™ symbol means "muscletech platinum" or "muscle tech" find nothing, and SKU search (MT26361) isn't supported.
- **Bhagirath can't be found as the customer (main issue).** He is on the staff list (Bhagirath Gurjar), not the member list, and the customer search at the counter only looks through members. So he, and any trainer or staff buyer, never shows up, and the sale can't be linked to his payroll.
- **No manual discount.** Only coupon codes reduce the price; there is no way to sell ₹1,499 at ₹1,300 and no record of who allowed it or why.

## What I'll build
1. **Smarter search** — ignores symbols (™, ®, commas), matches words in any order, "muscle tech" = "muscletech", and searches SKU too.
2. **Customer search includes staff and trainers.** A Member / Staff & Trainers / Walk-in switch, where Staff & Trainers searches your branch team by name, phone or employee code (for example "Bhagirath"). Results get a "Staff" or "Trainer" label.
3. **Manual discount on the bill** (₹ amount or %), with:
   - required reason (dropdown: Staff purchase, Loyalty, Damaged box, Manager approval, Other + note);
   - limits: staff role can give up to a branch-set % (default 10%); above that, or any discount by staff, needs a manager/owner; managers/owners can give any amount, never below cost without a warning;
   - GST recalculated on the discounted price.
4. **Payment options including "Deduct from salary"** (shown only for staff buyers) and "Due / pay later". Salary deduction:
   - is added automatically to that person's next payroll as a deduction line "Store purchase – invoice no.";
   - shows on the payslip and in the payroll review screen before payout.
5. **Audit trail for every sale** — who sold it, buyer, original price, discount, reason, who approved, payment mode, due amount. Shown in a new "Discounts & dues" view in Store History and in the audit log, filterable by seller and date.
6. **Record Bhagirath's purchase** — once built, I'll create his Glutamine sale at ₹1,300 (₹199 discount, reason "Staff purchase") as a salary deduction, after you confirm the price and the payroll month.

## Technical details
- Search: normalise both sides (NFKD, strip non-alphanumerics, lowercase), token AND-match across name, brand and SKU in `POS.tsx`.
- Server: extend `create_pos_sale` (atomic) with `p_buyer_type`, `p_staff_user_id`, `p_manual_discount`, `p_discount_reason`, `p_approved_by`, `p_payment_mode` incl. `salary_deduction`/`due`; role/limit checks inside the RPC (not client-only); new nullable columns on `pos_sales` (buyer_type, staff_user_id, original_amount, manual_discount, discount_reason, discount_approved_by). Stock movement unchanged.
- New `staff_store_deductions` table (sale, user, amount, status pending/applied, payroll_item_id), branch-scoped RLS, GRANTs; payroll calculation adds pending rows to `calc_deductions` / `calc_deduction_breakdown` and marks them applied on run finalisation.
- Branch setting `pos_staff_max_discount_pct` (default 10).
- Tests: discount limit by role, GST on discounted price, salary deduction lands in payroll once.
- Verify with Playwright as manager: search "muscle tech glutamine", sell to staff with discount and salary deduction, check history and payroll preview.

## Questions to confirm while building
- Default staff discount limit 10% — OK?
- Bhagirath's deduction: October or November payroll?
