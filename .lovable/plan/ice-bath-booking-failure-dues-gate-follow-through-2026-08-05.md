# Ice bath booking failure + dues gate follow-through

## What I verified

**Booking error (`column "gender" does not exist`)**
- `book_facility_slot` reads `SELECT lower(gender::text) FROM members WHERE id = p_member_id`. The `members` table has no `gender` column — gender lives on `profiles` (and `leads`, `employees`). So the gender check throws for every gender-restricted facility.
- Rehan is being booked into "Ice bath Male" (`gender_access = 'male'`), which is exactly the branch that runs the broken lookup. The two Female facilities and "Sauna Therapy Male" are also `under_maintenance = true`, so only Ice bath Male is bookable at all right now.

**Rehan's gate access**
- INV-INC-26-0038: ₹30,000, first ₹15,000 on 28 Jul, balance ₹15,000 paid today at 16:19 IST. Invoice is now `paid`, and `member_access_status()` correctly returns `allowed: true`.
- His biometric check-in today was at 14:38 IST — before the payment and before the dues gate went live, so the turnstile still had him enrolled. Both gate rows in `mips_device_face_state` still read `state = enrolled` (last touched 4 Aug); hardware access was never actually pulled back.
- Root cause for "he can still walk in": the sweep (`mips-access`, every 30 min) only ever **revokes**. There is no restore path at all — neither on payment nor in the sweep. So once dues blocking bites, a member who pays stays locked out until someone manually restores, and conversely a member whose revoke never fired keeps walking in.
- `mips-webhook-receiver` has no dues awareness, so a punch by a blocked member is still written as a normal attendance row.

**Booking notifications**
- `book_facility_slot` fires `_notify_booking_event` → `notify-booking-event`, which calls `send-whatsapp` / `send-email` directly. That bypasses `dispatch-communication`, so SMS/RCS, member channel preferences, quiet hours, dedupe and delivery logging are all skipped. There are no reminders and no cancellation policy text anywhere in the message.

## Plan

### 1. Fix the gender lookup (unblocks Rehan's ice bath booking)
Rewrite the gender check in `book_facility_slot` to read `profiles.gender` via `members.user_id`, falling back to no restriction when gender is unknown (never block a booking on missing data). Same fix applied to any sibling function that repeats the lookup.

### 2. Close the access loop: revoke *and* restore
- Add a `members_restorable_after_dues` counterpart and a restore pass to `mips-access` sweep: any member whose `hardware_access_status` is `revoked` with reason `dues`, who now has `allowed: true` and a live membership, gets `validTimeEnd` pushed back to their membership end date.
- Fire an instant restore from the payment path (`record_payment` / `payment-webhook`) so a member who clears dues is back in within seconds, with the 30-minute sweep as the safety net.
- Track why access was pulled (`hardware_access_reason`) so a dues revoke is never confused with a freeze/expiry revoke and restored by the wrong rule.
- Teach `mips-webhook-receiver` to consult `validate_member_checkin`'s denial reason: a dues-blocked punch records a denied access event plus a front-desk notification instead of a clean attendance row.
- Backfill now: reconcile Rehan's current state so hardware matches his paid status.

### 3. Booking confirmations, reminders and cancellation policy
- Rewrite `notify-booking-event` to route through `dispatchCommunication` so every enabled channel (WhatsApp / Email / SMS / RCS / in-app) fires per member preference, with dedupe keys and proper `communication_logs` entries.
- Message content: facility, date, time, branch, and the cancellation policy line (cancel-before window read from `benefit_settings`; falls back to a default text).
- Add a reminder rule to the Automation Brain that sends a slot reminder a configurable number of hours before the booking, and a cancellation confirmation on the cancel path.

## Technical notes
- Migration: `book_facility_slot` gender fix, `hardware_access_reason` column + `members_restorable_after_dues()`, restore hook on the payment path.
- Edge functions: `mips-access` (restore pass), `mips-webhook-receiver` (dues denial), `notify-booking-event` (dispatcher rewrite + policy text), new/extended reminder worker rule.
- No UI change required for the booking fix; a "Access blocked — dues" badge stays as previously planned.
