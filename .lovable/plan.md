# Phone and browser alerts for owners, admins and managers

## What I found
- The switch that turns on phone/browser alerts appears only on the member and trainer screens. Owners, admins and managers have no place to turn it on, so none of them is signed up: right now 19 members and 3 trainers have it on, and no owners, admins or managers.
- Late check-in alerts already exist. When a staff member clocks in late, owners and admins get an alert inside the app, and so does that branch's manager. Because nobody in those roles is signed up, the alert never reaches their phone.
- Each sign-up is tied to one branch. An owner who signs up while viewing one branch would miss alerts from the other branches.

## What will change
1. **Turn-on switch for the team**
   - A "Phone & browser alerts" card in Settings and on the profile page for owners, admins and managers, with Enable, Send test and Turn off.
   - A one-time reminder at the top of the admin dashboard until it's on, which can be dismissed.
   - On iPhone, it explains that the app must be added to the Home Screen first. iPhone only allows these alerts from the Home Screen app.
2. **Alerts from the right branches**
   - Owners and admins get alerts from every branch on that device.
   - Managers get alerts from the branches they manage.
   - Members and trainers stay as they are now.
3. **Important alerts reach the phone**
   - Every alert that already appears under the bell now also reaches signed-up phones. This includes late check-ins and the existing approvals, tasks and payments alerts.
   - Tapping the alert opens the right page. A late check-in opens the staff attendance page, and other alerts open the page the bell would open.
   - The lock screen shows only general wording such as "Late check-in — tap to view". Names, amounts and health details stay off the lock screen, the same as now.
4. **Check it works**
   - Sign up an owner device, send a test, then simulate a late staff check-in and confirm it reaches the phone.

## Technical details
- New `src/components/notifications/TeamPushCard.tsx` reuses `webPushService` and is mounted in `Settings.tsx`, `Profile.tsx` and the admin dashboard prompt. Visibility uses `can.X(roles)`.
- Migration:
  - `web_push_subscriptions.branch_id` becomes nullable, where null means all branches. Allowed only for owner/admin, enforced in the `web-push` subscribe action.
  - `enqueue_web_push` matches `s.branch_id IS NULL OR NEW.branch_id IS NULL OR s.branch_id = NEW.branch_id`.
  - Managers subscribe once per managed branch (`managed_branch_ids`).
- `web-push` function: the subscribe action accepts `scope: 'all'` for owner/admin. The lock-screen payload maps `category` (e.g. `staff_late`) to a general title and a deep link, and still contains no personal data.
- No change to the late check-in rule or to the WhatsApp/SMS/email channels.
