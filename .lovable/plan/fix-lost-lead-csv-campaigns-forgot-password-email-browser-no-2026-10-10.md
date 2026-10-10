# Fix: lost-lead/CSV campaigns, forgot-password email, browser notifications

## What I found
1. **Campaigns to "Lost leads" / CSV lists** — the campaign sender now replaces every requested recipient with a matching saved contact in that branch (the security hardening from the earlier round). "Lost leads" and uploaded CSV rows that don't match a saved member/lead/contact/staff get silently dropped, so the campaign shows "queued" but sends to nobody.
2. **Forgot-password email** — the reset step creates the link, then hands the email to the messaging service. That service only accepts staff roles or the system key; the reset helper's call is refused, so it returns a server error. The app then falls back to the built-in reset email, which hits its rate limit. Result: no email.
3. **Mohit Kalal (INC-26-0181) push** — his device is subscribed (1 subscription) and both "Booking confirmed" alerts for Steam Room 19:30 were queued, but nothing ever sends them: no scheduled job delivers the queue. 5 notifications have sat "pending" since 6 Oct for every member.
4. **Home-screen banner** — the "Add to home screen" card hides once installed, but the "Browser notifications" card always shows, even after it's enabled, taking dashboard space.

## Fixes
1. **Campaigns**
   - Lost leads: resolve the audience from the saved leads table (status lost, same branch) on the server, so they're always "saved" and pass the check.
   - CSV upload: on upload, save each new row as a branch contact (tagged with the campaign/list name, honouring do-not-contact), then send. The server rule (only saved contacts) stays, so the security fix is kept.
   - Campaign report shows "X skipped — not saved / opted out" instead of silently queuing zero; block "Send" with a clear message if the final audience is 0.
2. **Forgot password**
   - Let the messaging service accept the reset helper's system call (the same system-key path other backend jobs use), limited to transactional email.
   - Reset page: always show the same "If an account exists, we've sent a link" message; never show a raw server error. Light per-address throttle (1 request/minute) on the helper so the built-in limit isn't hit.
3. **Push delivery**
   - Add a scheduled job (every 1 min) that triggers delivery, gated so it only runs when something is pending (same pattern as other jobs).
   - Also kick delivery immediately when a notification is created, so booking alerts arrive within seconds.
   - Expire the 5 stale items (older than 24h are suppressed by design). Send Mohit a test to confirm.
4. **Dashboard banner (feature toggle style)**
   - Notifications card: when enabled on this device, collapse to a small "Notifications on" chip (with Turn off / Send test in a menu) instead of the full card; when installed but not enabled, show one compact prompt that can be dismissed (remembered per device).
   - Accessibility: chip is a real button with label, 44px target, status announced politely, error text linked to the control.

## Verify
- Send a test campaign to Lost leads and a 2-row CSV — both receive and the report counts match.
- Request a reset for a real account — email arrives, no error.
- Book a test slot as a member with push on — notification arrives; Mohit's test received (he confirms on phone).
- Mobile dashboard: card collapses after enabling.

## Technical details
- `send-broadcast` `rebindRecipients`: add lead-status audiences; CSV path upserts `contacts` before rebind; return `skipped` counts to `campaigns`/report.
- `_shared/requireCaller.ts` / `dispatch-communication`: allow service-role caller for `category:'transactional', channel:'email'`; `request-password-reset` invoked with service key header.
- New migration: pg_cron `web-push-deliver` with `WHERE EXISTS (pending web_push_deliveries)` + partial index on `status='pending'`; trigger/net call on deliveries insert.
- `BrowserNotifications.tsx` compact state; `MemberDashboard.tsx` ordering.
