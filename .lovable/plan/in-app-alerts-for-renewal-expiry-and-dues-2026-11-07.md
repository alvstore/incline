# In-App alerts for renewal, expiry and dues

## What already works (checked live)
- **Dues / overdue:** every payment reminder already creates an in-app notification ("Payment Reminder", opens My Invoices) next to WhatsApp/SMS/email. 135 sent in the last 30 days.
- **Expiring soon:** members get an in-app "Membership Expiring Soon" alert on each configured day before expiry (default 7/5/3). 69 sent in the last 30 days.
- Every in-app alert automatically goes to the bell, browser and the Flutter phone app.

## Gaps to fix
1. **Expiry day and after expiry:** nothing in-app once the membership actually ends (only WhatsApp from the Renewal Center, and that is currently switched off).
2. **Renewal Center outreach:** when it sends a renewal/win-back WhatsApp or email, no matching in-app alert is created.
3. **Overdue copy:** overdue reminders say "Payment Reminder" — make the title "Payment overdue" so it stands out.

## Changes
- Daily reminder job: add "Membership expired today" alert on the end date and one "Your membership has ended – renew" alert during the 7-day grace period (once each, opens My Membership). Respects the existing on/off switch for membership reminders.
- Renewal Center sender: after each case message, also send an in-app alert to the member through the shared dispatcher (dedupe per case + stage, so no repeats). Only fires when the Renewal Center is switched on — no new messages go out today.
- Overdue title change for payment reminders.
- No prices or amounts on the phone lock screen (existing rule kept); amounts stay inside the app.

## Technical details
- `send-reminders`: add expired/grace blocks using IST dates, dedupe via `dispatch_dedupe_key` (`membership_expired:{membership_id}:{day|grace}`), insert through the existing notifications batch (trigger `notifications_enqueue_web_push` already fans out).
- `renewal-engine-tick`: after dispatch, call `dispatch-communication` with `channel:'in_app'`, `user_id`, dedupe `renewal_case:{case_id}:{stage}:in_app`; in-app failure never fails the case.
- Mock tests for dedupe keys and expired/grace date selection; redeploy both functions. No real sends during testing.
