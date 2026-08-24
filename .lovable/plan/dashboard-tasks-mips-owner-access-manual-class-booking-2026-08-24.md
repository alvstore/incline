# Dashboard, Tasks, MIPS Owner Access & Manual Class Booking

Four fixes, verified against the live database before writing this plan.

## 1. "Today's Classes" widget shows the wrong number

**Confirmed cause.** The dashboard counts classes in a rolling 24-hour window that starts at UTC midnight, not at the Udaipur (IST) day boundary. Right now the club has 2 classes today (Yoga 08:30 and 18:00 on 24 Aug) but the widget counts 4, because the window also swallows tomorrow's two Aerobics classes.

**Fix**
- Compute the IST day start/end and query `scheduled_at >= IST today 00:00` and `< IST tomorrow 00:00`.
- Only count `is_active = true` classes.
- Make the card clickable — it opens `/classes` filtered to today.
- Add a small sub-line showing the next class time so the number is verifiable at a glance.

## 2. Tasks: missing dates, missing "who created it", weak notifications

**Confirmed state.** Task cards render only a due-date pill; nothing shows when the task was created or who raised it. The database triggers `trg_tasks_notify_assignee` and `trg_tasks_notify_broad_staff` exist and WhatsApp/Email/SMS templates for `task_assigned` are active, but the outbound message body never names the creator.

**Fix**
- **Task card / detail:** show "Created <relative time> by <name>" and the absolute created date on hover, plus due date + time already present. Add a "Raised by" row in the task detail drawer.
- **Task list:** the service already joins the assigner profile — surface it in the card and in the list view header.
- **Notifications:** include `created_by_name`, `branch_name`, and `task_id` in the WhatsApp/Email variable set, and update the three `task_assigned` templates so the message reads who assigned it, for what, priority, due date/time and a deep link.
- **Routing:** alerts go to the assignee, plus the branch manager/admin/owner (existing broad-staff path), and the assigned trainer when the assignee is a trainer. Trainers keep receiving only their own task alerts, not general admin traffic.

## 3. Live task widgets on every dashboard

New `MyTasksWidget` card, placed on the owner/admin/manager dashboard, staff dashboard and trainer dashboard:
- Counts: Open / Due today / Overdue, colour-coded (slate / amber / red).
- List of the next 5 tasks by due time, each with priority dot, due pill and assignee.
- Realtime subscription on `tasks` so a newly created or reassigned task appears without refresh, with a soft in-app toast and bell badge.
- Role-aware scope: owner/admin see all branches in context, manager sees their branch, staff/trainer see tasks assigned to them.
- Full loading skeleton, empty state ("No open tasks") and error fallback.

## 4. MIPS treats Yogita and Rajat Lekhari as outsiders

**Confirmed cause.** MIPS sync only knows three person types — `member`, `employee`, `trainer` — and reads each from its own table. The `employees` table has just two rows (a receptionist and a branch manager). Yogita Lekhari and Rajat Lekhari exist only as `profiles` + `user_roles` (admin/owner) with no `employees` record, so the turnstile has no person to match and treats them as unknown.

**Fix**
- Create employee records for the owner and admin (`Owner` / `Director` position, head branch, active), linked to their existing user accounts, so they enter the normal staff sync path.
- Add a guard in the staff screens: any user holding `owner`/`admin`/`manager` without an `employees` row is flagged in HR with a one-click "Create staff record & enrol" action, so this never silently recurs.
- Owner/admin staff records sync with an open validity window and are exempt from dues-based revocation (that gate is member-only) — access stays on as long as the record is active.
- After the records exist, enrol their face/biometric from the existing enrolment drawer and push to devices.

## 5. Manual class booking for staff

**Confirmed state.** `ConciergeBookingDrawer` can book a class, but it is only reachable from All Bookings, shows classes as a plain list, refuses to help when a class is full, and offers no cancel/reschedule or multi-member booking. The Classes page has no "book a member" action at all.

**Fix**
- Rework the drawer's class step into visual class cards: banner thumbnail, name, time, trainer (including freelancer names), and a capacity bar with "x of y booked".
- Multi-member booking: search and stage several members, then confirm in one action with a per-member success/failure summary.
- Full-class handling: offer "Add to waitlist" (existing `add_to_waitlist` RPC) instead of a dead end, and show current waitlist position.
- Add a "Book member" quick action on each class card in `/classes` that opens the drawer pre-scoped to that class.
- On All Bookings, add row actions for class bookings: mark attended, cancel (with reason), and move to another session of the same class.
- Every booking made by staff is recorded with its source so the audit trail shows it was a manual/concierge booking.

## Technical notes

- Dashboard class count moves to an IST-anchored range helper in `src/lib/utils/datetime.ts`; the same helper replaces the other `toISOString().split('T')[0]` day boundaries on that card row.
- New `src/components/dashboard/MyTasksWidget.tsx` using TanStack Query + `useRealtimeInvalidate` on the `tasks` table; mounted in `Dashboard.tsx`, `StaffDashboard.tsx`, `TrainerDashboard.tsx`.
- Task creator surfacing uses the existing `assigner` join in `taskService.fetchTasks`; notification variables extend `src/lib/tasks/taskNotify.ts` and the three `task_assigned` template rows are updated in place.
- Owner/admin staff records are inserted as data (not schema) and reuse the existing `sync-to-mips` `employee` path — no new person type.
- Class booking work stays in `ConciergeBookingDrawer.tsx`, `Classes.tsx` and `AllBookings.tsx`; booking still goes through the `book_class`, `add_to_waitlist` and `cancel_class_booking` RPCs.
- All new surfaces follow the Vuexy rules: side drawers for data entry, `rounded-2xl` cards, coloured status badges, lucide icons, skeleton/empty/error states.
