# Seller and collector names everywhere, open discount limit, Bhagirath's advance

## What we found
- Bhagirath's ₹32,000 advance from 18 Sep is still marked "outstanding ₹32,000" even though you recovered it in his September salary. October payroll would deduct it again.
- Many records don't store who did the work: 129 of 242 memberships, 211 of 315 invoices and 165 of 340 payments have no person saved. The screens show "System" for those. Store sales (2 of 2) do have a seller saved.
- Front-desk staff discounts are capped at 10%.

## What we'll build

1. **Close Bhagirath's advance.** Mark the ₹32,000 advance as recovered in September and save a note in the audit log. First we check the September payroll. If it already shows the ₹32,000 deduction, we link the advance to it. If it doesn't, we stop and ask you before changing anything.

2. **No discount limit, but every discount is recorded.** Remove the 10% cap so staff can give any discount. A reason is still required, and staff still can't discount their own purchases. Each discount goes into a new **Discount audit report** that shows the staff member, their role, the % given, the reason, the bill and the date. Discounts above 10% get a "High discount" flag. You can filter by staff member and month and download the report as CSV.

3. **Save the person's name at every step, admins and owners included.** The person who is signed in is saved automatically on the server, so the app can't skip it:
   - Membership sold: **Sold by** and the time
   - Invoice created: **Created by**
   - Payment received: **Received by** and the time. This covers manual payments, partial payments, POS and lockers. Online payments show "Online (Razorpay)"
   - Store sale: **Sold by** and **Discount given by**
   - Void, refund, freeze, cancel, complimentary membership and due-date change: **Done by** and the time
   
   "System" will only show for automatic actions such as nightly renewals or payment-gateway confirmations, and those will say what triggered them. Older records with no person saved will show "Not recorded (before 22 Oct)". Where the audit log shows who did it, we fill in the name from there.

4. **Show it on screen.** The member profile (memberships, payments, invoices), the Invoices and Payments lists, the receipt and invoice PDFs, and Store → Discounts & dues will show "Sold by", "Received by" and "Discount by" with the date and time.

## Technical details
- Data fix (step 1): set the advance's `outstanding=0`, `status='recovered'` and audit it, after we confirm the September `payroll_items` row for user 57173ed8 shows the advance.
- Migration: add or confirm `created_by` on memberships/invoices, `received_by` on payments and `actor_id` on reversal tables. Add BEFORE INSERT triggers that fill them from `auth.uid()` when NULL. Requests with no user signed in (cron, webhooks) set `actor_kind` ('automation'/'gateway').
- Backfill from `audit_logs` (`record_id` + INSERT action → `user_id`) only where the field is NULL.
- `create_pos_sale_audited`: drop the cap check but keep `pos_staff_max_discount_pct` as the flag threshold. Create `pos_discount_audit` view/RPC (branch-guarded, owner/admin/manager).
- Shared `ActorLabel` component using `useActorNames`. Replace every `|| 'System'` fallback.
- Tests: discount over 10% is accepted and flagged; a payment insert without received_by gets the signed-in user's id.
