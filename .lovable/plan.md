# Purchase Membership drawer: backdating, due-date presets, UTR capture

## What I confirmed

- **Start date is hard-locked to today.** The date input uses `min = today` (or tomorrow with Advance booking on), so a member who has been training since 27 Jul can only be started from today — the gym loses those days. The purchase RPC itself has no such restriction: it only checks `p_start_date > current_date` to decide Scheduled vs Active, so a past start date is already safe server-side.
- **The member is shown twice.** `MemberIdentityHeader` renders name/avatar/code at the top, and a second "Member Info" card right below repeats the same name plus a raw truncated member UUID.
- **Due Date for Remaining is a bare date input** with `min = tomorrow`, no quick presets.
- **No transaction/UTR field in the purchase drawer.** `RecordPaymentDrawer` has one (shown for every method except cash/wallet) and passes it to `record_payment`, but `purchase_member_membership` has no `p_transaction_id` parameter at all, so the first payment taken during a purchase is saved with no reference number.

## Changes

### 1. Allow backdated start dates (staff only)
- Remove the today floor for staff. Add a small "Backdate" affordance: when the picked start date is in the past, show an amber note stating the membership will be treated as already running from that date, with the computed end date and how many days of cover are already consumed.
- Keep the floor for member-facing mode and keep Advance booking (future dates) exactly as it works today; the two toggles stay mutually exclusive.
- Cap backdating at a sane window (e.g. 90 days back) so a typo can't create a wildly historical membership.

### 2. Remove the duplicate member block
- Delete the second "Member Info" card. `MemberIdentityHeader` stays as the single identity surface; the raw member UUID is dropped from the UI.

### 3. Due-date presets for the remaining balance
- Add quick chips: 3 days · 7 days · 10 days · 15 days · Custom, each auto-computing the date from today, with the active chip highlighted and the date input still editable.
- Keep the live "Remaining ₹X · Due on <date>" summary in sync with the chosen preset.

### 4. Transaction / UTR reference, synced with Payments
- Show a "Transaction / UTR ID" field in the purchase drawer whenever the method is UPI, Bank Transfer, or Card (same rule as `RecordPaymentDrawer`), with UPI/bank-appropriate placeholder text.
- Extend `purchase_member_membership` with a `p_transaction_id` argument and pass it through to the payment row it records, so the reference shows on the Payments page and in the invoice payment history — the same value staff would have typed in Record Payment.
- Field is optional (no forced entry) but recommended, matching current Record Payment behaviour.

## Technical notes

- Frontend: `src/components/members/PurchaseMembershipDrawer.tsx` only — start-date `min`/warning, remove the duplicate card, due-date preset chips, transaction ID state + input, added RPC argument.
- Database: one migration replacing `purchase_member_membership` with an added trailing `p_transaction_id text DEFAULT NULL` that flows into the payment it creates. Existing callers are unaffected because the argument defaults.
- No change to GST, discount, locker, reminder or Razorpay-link logic.
