# Block services beyond membership end date

## What happened (confirmed)
Arpit Bansal (INC-26-0239): membership 2 Nov to 11 Nov 2026. On 10 Nov he booked Steam Room Male for 12 Nov, the day after it ends. The booking check only asks "is the membership active today?" and never "will it still be active on the slot date?".

## Rule
A member can use or request a service only on days covered by an active membership. Expired, cancelled, frozen or pending memberships switch off every service.

## Fix
1. **Facility bookings** (steam, sauna, ice bath, cold plunge and others): refuse when the slot date is after the membership end date, or before its start. Message: "Your membership ends on 11 Nov. Renew to book after this date."
2. **Reschedule**: the same check applies to the new date.
3. **Class bookings and waitlist**: the same check on the class date.
4. **Member requests** (locker requests, comp/gift, freeze requests and similar): refused when the membership has no active days left.
5. **Member booking screen**: dates after the end date are greyed out with a "Renew to book" note. The server stays the real gate.
6. **Automatic cleanup**: when a membership expires or is cancelled, future bookings past its end are cancelled, any used credit is returned, and the member gets a notice.
7. **Staff override**: owner/admin can still force-book (existing option). Every override is written to the audit log.
8. **Existing bad bookings**: list every future booking that falls after its membership end date (Arpit's 12 Nov steam booking included). Staff review the list before anything is cancelled.

## Technical details
- `book_facility_slot`: replace the `end_date < today` check with slot-date validation (`slot_date BETWEEN start_date AND end_date`, status active), returning a `{success:false, error:'membership_not_covering_date', message}` payload.
- Apply the same validation in the reschedule RPC, `book_class` (via its validation helper) and `add_to_waitlist`.
- Request-type RPCs (locker request, approval creation for members) call one shared helper, `member_has_active_coverage(member_id, date)`.
- Trigger on memberships going to expired/cancelled: cancel future benefit/class bookings beyond end_date via the existing release helpers, which restore credits. Notify through dispatchCommunication.
- Branch setting `enforce_booking_coverage` (default on) acts as a kill switch.
- Tests: booking a slot one day after end_date is refused; a slot on end_date is allowed; reschedule past end_date is refused.
