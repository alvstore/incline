# Stop creating bills for payments that were never completed

## What is happening today

When a member buys a recovery add-on from their portal and then cancels or closes the
payment window, a real bill is still created and left as "pending".

Confirmed from the live data for Kavin Jain (INC-26-0155):

- Bill INV-INC-26-0142, Add-On, ₹1,000, nothing paid, created 21 Sep, still pending.
- The bill already took a number in the official numbering series, so cancelling it
  manually leaves a gap in the sequence.
- Its due date is set to the day it was created, so the overdue check treats the member
  as owing money and turnstile access is withdrawn.

Cause: the purchase step writes the full bill (number, due date, amount owed) *before*
the payment window even opens. There is a cleanup call that removes the bill when the
payment is cancelled, but it only runs if the member stays on the page — closing the tab,
losing signal or a browser block leaves the bill behind. There is also no scheduled
cleanup job to catch these later.

## The fix

1. **Nothing owed until money arrives.** For online add-on purchases, hold the order as a
   draft: no bill number, no due date, not counted as an outstanding amount. A member
   with an unfinished checkout is no longer treated as having dues, so gate access is not
   withdrawn and no manual cancellation is needed.
2. **Number the bill at the moment of payment.** The official number is issued only when
   the payment is confirmed, so the numbering sequence stays unbroken.
3. **Automatic clean-up.** A scheduled job removes drafts abandoned for more than 30
   minutes, so nothing lingers even if the member closes the browser mid-payment.
4. **Keep the existing on-page clean-up** as an immediate first line, and also apply it
   when the payment page itself is abandoned (currently only the add-on drawer does it).
5. **Repair Kavin's record.** Remove the abandoned ₹1,000 bill and re-check his access so
   the turnstile block from this phantom due is lifted.
6. **Member portal wording.** Show unfinished checkouts as "Payment not completed" with a
   Retry action, instead of listing them among bills to pay.

## Technical details

- `purchase_benefit_credits` (deferred settlement path): insert with
  `status='draft'`, `due_date`/`payment_due_date` NULL and `invoice_number` left unset.
- `generate_invoice_number`: skip drafts on insert; add a BEFORE UPDATE branch that mints
  the number and `document_series` when status leaves `draft`. Existing numbered rows are
  untouched.
- Settlement path (`settle_payment` via `verify-payment` / `payment-webhook`) moves the
  invoice out of draft, which triggers numbering plus the existing
  `activate_benefit_credits_for_invoice` step.
- `member_access_status` already counts only `pending/partial/overdue` with a due date, so
  drafts are naturally excluded — no change needed there; confirm
  `trg_auto_evaluate_access_on_invoice` no longer fires a block on these rows.
- `abandon_online_addon_invoice`: accept `draft` as well as `pending` (still amount_paid = 0,
  `invoice_type='benefit_addon'`, owner-or-staff check unchanged).
- New `reap_abandoned_addon_invoices()` (service_role only) + pg_cron entry every 15 min,
  deleting draft add-on invoices older than 30 minutes with no payment rows, dispatched
  through the existing `automation-brain-tick` rule set rather than a standalone cron.
- `MemberCheckout.tsx`: on Razorpay `ondismiss`/failure for a draft add-on invoice, call
  the abandon RPC before showing the error.
- `MyInvoices.tsx` / pending-dues queries: exclude `draft`, and surface them in a separate
  "Incomplete checkout" section.
- Data repair for INV-INC-26-0142 (`ca805195-…`) via the abandon RPC, then
  `evaluate_member_access_state` for member `563986f2-…` with force sync.
