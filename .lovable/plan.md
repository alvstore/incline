# Fix plan: membership days, invoice correction, locker billing, backdated payments, MIPS photo verify

## What I confirmed in the live data

- **Mukesh Singh Chouhan (INC-26-0053)** — Quarterly Plan (`duration_days = 90`), stored `start_date 2026-07-31`, `end_date 2026-10-28`. That is only 89 days of cover, and the members list then shows **88d** because remaining days are counted from the current timestamp, not from the start of today.
- **Jai Patel (INC-26-0050)** — `INV-INC-26-0060`, total ₹25,900, paid ₹4,000, status partial. The "Correct invoice amount" action already exists but is only rendered inside the Invoices page drawer and only for roles that can approve discounts — it is not reachable from the member profile.
- **Locker assignment is broken at the database level.** Both versions of `assign_locker_with_billing` create the rental invoice without a `subtotal` value, and `invoices.subtotal` is NOT NULL with no default. Any chargeable locker assignment therefore fails. This is the "no sub total in database" error.
- **Payments cannot be backdated.** `record_payment` has no date argument, so `payments.payment_date` always falls back to `now()`.
- **`membership_free_days` is empty and has no UI** — gifted/extension days currently cannot be granted or viewed. Complimentary *sessions* (`member_comps`) do work and are visible in Benefit Tracking.
- **MIPS verify** returns `has_photo` from the server lookup but never stores it and never triggers a photo re-push, so a person registered without a face image stays that way and the turnstile reports "stranger".

## Changes

### 1. Membership duration and days remaining
- Compute the end date as an inclusive calendar period: month-based plans (30/90/180/365) end on the same calendar date next month/quarter/half-year/year minus one day, so a quarterly plan bought on 31 Jul ends 30 Oct, not 28 Oct.
- Count remaining days from the start of today so a plan ending 30 Oct reads 91d on the purchase date instead of 88d.
- Backfill the existing active memberships whose end date was computed with the old formula, including Mukesh's.

### 2. Invoice correction reachable from the member profile
- Surface the existing "Correct invoice amount" and "Cancel invoice" actions on each invoice row inside the member profile drawer, with the same role gating used on the Invoices page.
- Apply Jai Patel's correction: ₹25,900 → ₹25,000, keeping the ₹4,000 already paid and leaving the invoice partial with the corrected balance.

### 3. Locker rental billing
- Fix both overloads of `assign_locker_with_billing` to write `subtotal` (the taxable value) alongside `total_amount`, plus `tax_amount` and `invoice_number` consistent with other invoice creators.
- Keep the flat rental-fee input already in the assign drawer; show a live sub-total / GST / total breakdown before confirming.

### 4. Backdated payments
- Add an optional payment-date argument to `record_payment`, defaulting to now, validated to not be in the future.
- Add a "Payment date" field to the record-payment UI, visible only to roles allowed to backdate, defaulting to today.

### 5. Membership free days / gifts
- Add a small "Gift days / extend membership" action in the member profile that writes to `membership_free_days` through a new atomic RPC and pushes the membership end date out by the granted days, with an audit entry.
- List granted days and gifted sessions together in the member profile so staff can see and revoke them.

### 6. MIPS photo verification
- After a verify run, persist the result per person (registered / registered-without-photo / missing) instead of only toasting.
- When verification reports a person present but without a photo, automatically re-run the two-step photo upload for that person rather than marking them synced.
- Show a "Registered, no face" state in Personnel Sync so these people are visibly actionable, and count them separately from "No Photo" (which means no photo in the CRM at all).

## Technical notes

- Database work goes in migrations: replace both `assign_locker_with_billing` overloads, add the payment-date parameter to `record_payment`, add the free-days grant RPC, and run the membership end-date backfill as a data update.
- Frontend touches `PurchaseMembershipDrawer.tsx` (end-date math), `Members.tsx` (inclusive day count), `MemberProfileDrawer.tsx` (invoice actions, gift days, granted-days list), `AssignLockerDrawer.tsx` (fee breakdown), the record-payment drawer (date field), `PersonnelSyncTab.tsx` and `sync-to-mips` (verify persistence and photo re-push).
- Membership end-date math will live in one shared helper so purchase, renewal, freeze and transfer all agree.
