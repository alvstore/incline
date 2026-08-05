# Booking deduction, notifications, and branch-scoped manager writes

## What the audit found (verified against the live database)

**Rehan khan (INC-26-0030) — Ice Bath, Fri 07 Aug 12:15**

1. **Booking never touches the benefit balance.** The booking row exists (`booked`, created 05 Aug 11:26 UTC), but `benefit_usage` for his membership is empty and he holds no rows in `member_benefit_credits`. `book_facility_slot` only inserts the booking and increments `booked_count` — it never calls the usage/credit engine. So the dashboard correctly still shows 6/6 Ice Bath: nothing was ever deducted, at booking time or at any later point. There is no code path that converts an attended booking into usage either, so a booked session can never consume a credit today.

2. **The slot is typed wrong.** The slot carries `benefit_type = 'other'` while `benefit_type_id` points at Ice Bath. Everything keyed off the enum therefore misses: the `benefit_settings` lookup (cancellation window, daily limits, no-show policy), the per-day booking cap, the notification's benefit name, and any future credit matching, which resolves by `benefit_type`.

3. **No message was sent.** `communication_logs` has nothing for this booking; `notify-booking-event` has no invocations at all; and there is no `pg_net` response row at 11:26 for the dispatch (only cron traffic before and after). `_notify_booking_event` fires through `net.http_post` inside the booking transaction with the failure swallowed, so a dispatch that never lands leaves no trace anywhere. Permissions and `pg_net` are fine, so the likely cause is that the booking ran before the notifier was in place — but that is unconfirmed, so verifying a fresh dispatch is step one, not an assumption.

## The fix

### 1. Make bookings consume the benefit (deduction engine)

- Reserve at booking: `book_facility_slot` calls the existing atomic consumption path (plan benefit → gift → purchased credit) and records the reservation against the booking.
- Release on cancel: `cancel_facility_slot` refunds the reservation when cancelled inside the cancellation window; late cancellations and no-shows follow the branch's `no_show_policy` (`mark_used` keeps it consumed, `allow_reschedule` refunds, `charge_penalty` keeps it consumed and flags it).
- Finalise on attendance: marking attended keeps the consumption and stamps the usage row with the real slot date/time so Usage History matches the booking.
- Block at booking time when the member has neither plan allowance, gift, nor credit left — with a clear message instead of a silent 6/6.
- Backfill Rehan's existing booking so it holds a reservation against his Ice Bath allowance.

### 2. Fix slot typing

- Slot generation and manual slot creation must write the correct `benefit_type` enum derived from the benefit type's code (via the existing `safeBenefitEnum` mapper) instead of falling back to `other`.
- One-off correction of existing slots that have a `benefit_type_id` but a wrong/`other` enum, including Rehan's Friday slot.

### 3. Make booking notifications actually deliver

- Re-fire the notifier for Rehan's booking and confirm delivery in `communication_logs` before calling it fixed.
- Replace the fire-and-forget `net.http_post` with a recorded dispatch: log every attempt (and its failure) so a dropped notification is visible instead of silent.
- Confirm the confirmation message carries the cancellation policy, benefit name, date/time and branch across WhatsApp, Email, SMS and in-app, honouring the member's channel preferences.
- Confirm the reminder sweep is registered in Automation Brain and picks up Friday's slot.

### 4. Branch-scope the remaining manager writes

Apply the same branch scoping already used elsewhere to the three outstanding findings: global settings/communication templates, Google review replies, and plan benefit definitions — managers limited to their assigned branches, owner/admin unchanged.

## Verification

- Book a fresh Ice Bath slot for a test member: balance drops by one immediately, Usage History shows the entry, and a WhatsApp + email confirmation with the cancellation policy lands in `communication_logs`.
- Cancel inside the window: the credit returns. Cancel late: it stays consumed per branch policy.
- Rehan's Friday booking shows a deduction, and his confirmation message is delivered and logged.
- A manager account can no longer write settings, templates, review replies or plan benefits outside its own branch.
