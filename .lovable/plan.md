# Revoke sign-in and stop messages for offboarded staff and lapsed members

## What changes
1. **Offboarded staff, trainers and managers**: sign-in is blocked and every open session ends the moment they are offboarded. Today the app checks this only after sign-in, and only signs them out of the browser. People who are also members keep member access.
2. **Members**: the sign-in account is blocked when the member is marked inactive, suspended or blacklisted, or when 7 days have passed since the membership expired with no active or upcoming membership. Renewing or reactivating the member unblocks the account straight away.
3. **Messages stop**: once access is revoked, no in-app, push, WhatsApp, SMS, email or RCS messages go to that person. This includes renewal and dues reminders. Their phone and browser push registrations are removed. Restoring the person turns messages back on.
4. **Sign-in page**: shows a clear message ("Your access has ended — please contact the front desk") in place of a generic error.
5. **Audit**: every block and unblock is recorded with who did it, or "automatic", and why.

Trade-off: your choice of "stop everything" means members who are past the grace period will not get win-back or overdue messages, and the Renewal Center will not message them automatically. Staff can still call them.

## Technical details
- New `access_revocations` record (subject user, kind staff/member, reason, revoked_at, restored_at), service-role writes only, owner/admin read.
- DB triggers on `employees`/`trainers` (offboarded/inactive), `members.status`, and `memberships` changes call `evaluate_login_access(user_id)`. That function enqueues a job, and the existing `member-login-access` function processes it: ban with `ban_duration`, then `auth.admin.signOut(user, 'global')`, or unban. It uses the `x-internal-token` pattern, and the cron gate uses an indexed pending-work predicate.
- A daily sweep catches members whose grace period ended, because no row changes when time passes.
- `offboard-staff` always runs the ban and global sign-out (no longer optional). `restore-staff` lifts the ban.
- `dispatch-communication` refuses sends for revoked recipients (`suppressed: access_revoked`). The `web-push` function and the notification insert path skip them too. Push subscriptions are deleted on revoke.
- The AuthContext check is extended to members as a safety net. The sign-in page handles `reason=revoked`.
- RLS stays as it is. The ban blocks new tokens, and the existing token expires within an hour, after global sign-out stops refresh.
- Tests: grace-boundary rule (day 7 is still allowed, day 8 is blocked), the member-plus-staff exception, and dispatcher suppression.
