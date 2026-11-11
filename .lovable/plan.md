# Lock all member services to the membership end date

Goal: after a member's membership end date, they cannot book anything or send any request. Staff can still act on their behalf, and every override is recorded.

## What members will see
- **Booking screen:** days after the membership end date are greyed out in the date strip and the calendar, with a "Renew to book" badge. If there's no active membership, the screen shows one "Renew your membership" card instead of slots.
- **Requests screen:** the "New request" options (locker, freeze, comp, plan change, PT and so on) are disabled after expiry, with a short "Your membership ended on DD Mon — renew to continue" note and a Renew button.
- **Dates inside a request** (freeze start/end, locker start and so on) can't be picked past the end date.
- **Renew:** members can still renew and pay dues; only renewal and paying is allowed.

## Server rules, so the app can't be bypassed
- Requests a member files themselves (approval requests, and request tasks they create about themselves) are refused when the member has no active membership covering today. Any requested date past the end date is also refused.
- Freezing a membership is refused if the freeze would start after the end date.
- Locker approval is refused if the membership has ended.
- Staff, managers and owners are not blocked. Their overrides are already logged.
- The existing per-branch on/off switch for the booking rule covers these new checks too.

## Technical details
- Add a helper that returns the member's current active membership with its end date. Use it in a shared `useMemberCoverage` hook.
- `MemberClassBooking.tsx`: cap the date strip and calendar `disabled` at the membership end date, show greyed days, and show a server error code `membership_not_covering_date` as a friendly message.
- `RequestComposerDrawer.tsx` and `MemberRequests.tsx`: disable submitting when not covered, and cap date inputs at the end date.
- Add a BEFORE INSERT trigger on `approval_requests` and on member-created `tasks` (where the creator is the linked member). It applies only when the caller is a member, and raises `membership_not_covering_date`. Renewal and payment request types stay allowed.
- Add an end-date check in `freeze_membership` and `approve_locker_request` when a member calls them.
- Tests: expired member's request refused; request on the end date allowed; freeze starting after the end date refused; staff override allowed.
