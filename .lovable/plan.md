# Paid class booking: stop leftover invoices and double charges

## What the audit found
- **The gap is real.** For a paid class, the server creates the invoice **first** and only then saves the booking. If saving the booking fails (for example "Already booked" because of a double-tap or two staff booking the same member at once), it returns "failed" but keeps the invoice. The member is left with an unpaid bill for a class they aren't booked into, and it would show in Dues and payment reminders.
- **A double tap can cause it.** The member's Book button sends straight to the server. If the connection is slow or drops ("result unknown"), pressing again can send a second request. The failure message is the raw server text.
- **No harm yet.** No class currently has a price, and there are no class invoices in the system, so there's nothing to clean up. This is prevention.

## What I'll change
1. **Booking first, invoice second, all or nothing.** The server saves the booking before creating the invoice. If any step fails, everything is undone, so no invoice without a booking and no booking without its invoice.
2. **One invoice per booking.** Rebooking after a cancellation reuses the open unpaid invoice for that class instead of making a new one. Two requests at the same moment are queued, so only one goes through.
3. **Clear outcomes for members:**
   - Booked: "Class booked." Paid classes add "Invoice created, pay from My Invoices", with a link.
   - Already booked: shown as a friendly note, not an error.
   - Result unknown (network dropped): "We couldn't confirm your booking. Checking…". The app reloads the member's bookings and shows the real result. It does **not** let them press Book again until that check finishes.
4. **Book button locks while sending**, for the specific class being booked, so a double tap is ignored.
5. **Cancelling a paid booking** marks its still-unpaid invoice as cancelled, so no reminder goes out for a class the member dropped. Paid invoices stay untouched and still go through the normal refund process.

## Technical details
- Migration: rewrite `book_class` to take `pg_advisory_xact_lock(hashtext(class_id||member_id))`, insert or upsert the booking first, return early before any invoice when `_booking_id IS NULL`, look up an existing open invoice item (`reference_type='class_booking'`, same class and member, status pending/partial/overdue) before calling `create_manual_invoice`, and `RAISE EXCEPTION` (not return) if invoice creation fails so the whole transaction rolls back. Return `{success, booking_id, mode, invoice_id, already_booked}` with stable `code` values (`already_booked`, `class_full`, `invoice_failed`). Keep existing guards and grants.
- `cancel_class_booking`: cancel the linked unpaid class invoice (no payments) in the same transaction; audit it.
- Front end (`MemberClassBooking.tsx`, `classService.bookClass`): map codes to friendly copy; on transport errors, treat the result as unknown, refetch bookings, and show the real state; disable the button for that class while the request runs or the check is unresolved; add a "Pay now" link when an `invoice_id` comes back.
- Tests: helper that maps server results and transport errors to member-facing outcomes (booked / already booked / unknown / failed).
