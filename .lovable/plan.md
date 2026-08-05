# Member Booking Upsell + Add-on Checkout Repair

Two confirmed defects, both verified against the live database.

## 1. Members literally cannot see recovery slots

Verified: 12 active "Ice bath Male" slots exist for 7 Aug 2026 at the Incline branch, and Mohit Gurjar (INC-26-0025) is male at that same branch. The agenda is still empty because the read rule on recovery slots only grants visibility to owners/admins and to staff with an explicit branch assignment. Members have no such assignment, so every slot is filtered out before it reaches the app — for every member, every day. This is not about Mohit's plan not including Ice Bath.

Also noticed: of 54 slots on 7 Aug, 42 are inactive (all the Sauna ones), so even after the fix only Ice Bath will appear until sauna slots are generated/activated.

Fix:
- Update the recovery-slot read rule so a member can see active slots at their own branch (reusing the existing member-branch helper), keeping the current staff/owner rules unchanged.
- Same treatment for the facility rows the slots join to, so names and gender rules still resolve.

## 2. Buying an add-on fails with "invalid input value for enum invoice_status: unpaid"

Verified root cause: a safety trigger that runs on member-created invoices (`recompute_member_invoice_totals`) sets the status to `unpaid`, which is not a valid invoice status in this database (valid values are draft, pending, paid, partial, overdue, cancelled, refunded). Every member-initiated add-on purchase therefore aborts.

The same trigger also zeroes the invoice totals on insert, because line items are added after the invoice row. For a member-initiated add-on this would produce a ₹0 invoice even after the enum is fixed — so Razorpay would be asked to collect nothing.

Fix:
- Correct the invalid status to `pending`.
- Let the trigger skip its zeroing pass when the invoice is created by a trusted server routine (the add-on purchase function runs with elevated rights), so the ₹1,500 total survives. Client-side invoice inserts stay locked down exactly as today.
- Re-verify the online path end to end: purchase creates a pending invoice, Razorpay checkout opens, payment verifies, credits activate.

## 3. Turn the empty day into a marketing surface (skill: ui-ux-pro-max)

Right now a member with nothing booked sees a dead end. Instead, the Book & Schedule page will always sell:

- **Entitlement-aware slot cards.** Every visible slot shows either "Book" (member has credits) or a locked state with "Unlock from ₹1,500" that opens the add-on purchase sheet pre-selected to that facility's package.
- **Upsell block replaces the blank empty state.** When a day has nothing bookable for the member, show the recovery add-on offers for the branch (benefit name, what it does, price, validity) with a single primary CTA, rather than "Nothing scheduled for this day".
- **Always-on "Available to add" strip** below the agenda for members whose plan lacks a facility, with the benefit's real copy (DOMS, inflammation, focus) already stored on the packages.
- Visual language stays Vuexy: rounded-2xl cards, soft shadows, indigo/violet primary with an amber "not in your plan" badge, lucide icons only, 150-300ms hovers, skeletons while loading, 44px touch targets, and aria-labels on icon buttons.

## Technical notes

- Database migration: replace `'unpaid'::invoice_status` with `'pending'` in `recompute_member_invoice_totals` and add a trusted-caller bypass; extend the `benefit_slots` and `facilities` SELECT policies with the member-branch predicate.
- Frontend: `src/pages/MemberClassBooking.tsx` (entitlement map from `member_benefit_credits` + plan benefits, locked card state, upsell empty state), reuse `EligibleAddOns` and `PurchaseAddOnDrawer` with a `defaultPackageId` prop so the CTA lands on the right package.
- No change to `purchase_benefit_credits` signature; the online branch already defers settlement and activates credits after verification.

## Verification

- Sign in as a member in the preview, open Book & Schedule on 7 Aug, confirm Ice Bath slots render and locked cards show the upsell.
- Run an add-on purchase with "Pay online" and confirm the invoice is created at the full ₹1,500 with Razorpay opening.
