# Trainer dashboard redesign + trainer-scoped Classes page

## What changes for the trainer

1. **Duty card "Last seen"** — show the gate's friendly name (e.g. "Main entrance") instead of the raw device serial `F06D92740D0062CF`. Fallback order: device name → branch name + "gate" → "Gate". Never show the serial.
2. **My Tasks** — replace the current widget with the compact Task Pulse style used on the admin dashboard (counts strip: overdue / due today / open, plus the top 3 tasks), filtered to the trainer's own tasks.
3. **Today's sessions** — "19:37 · 60 min" was Simpy Kaur's automatically logged PT visit with no explanation. Each row will read clearly: member avatar + name, package, "Checked in 19:37 · auto-marked by gate" (or "Booked 18:00" for appointments), and a status badge with icon + word (Attended / Upcoming / Missed). Times shown in IST.
4. **My clients** — member photo (initials fallback) on every row; PT clients first with package + expiry badge (amber when under 7 days), general-training clients grouped below under a quiet "General training" label instead of repeating "General training / General".
5. **My upcoming classes** — date-first, like the member view: a horizontal strip of the next 7 days (Today, Tomorrow, Thu 23…) with a class count per day; picking a day lists that day's classes by time with booked/capacity ("2 / 4 booked") and category label (no raw "other").
6. **Layout** — bento grid: top row duty + shift + 4 KPI tiles; then PT attendance (wide) + My Tasks; then Today's sessions + My clients; then classes full width. Theme tokens only, rounded-xl, border-border, lucide icons, loading/empty/error states, 44px tap targets, mobile single-column.

## Classes page for trainers (/classes)

- Hide the admin-only "Active Trainers" stat; show trainer-relevant stats instead: my sessions this week, my bookings, my attendance rate.
- Sessions tab and Master calendar default to **my classes only** (a toggle "All branch classes" stays read-only for viewing).
- **Classes & rules:** trainers see and edit only rules where they are the trainer; "New class rule" pre-fills and locks the trainer to themselves. Other trainers' rules are hidden. Owners/managers unchanged.
- Server enforcement: class rule/session create & update is refused if a trainer tries to set or edit another trainer's class (not just hidden in the UI).
- Attendance tab: only rosters of the trainer's own sessions.

## Safety switch
Branch setting `trainer_class_self_manage` (default ON). Off = trainers get view-only Classes (no create/edit), for branches that want management to own the schedule.

## Technical details
- Device name: join gate presence `device_sn` to `access_devices`/`hardware_devices` name in the presence query; helper `gateLabel()` with test.
- Tasks: reuse `taskPulseShared` + `TaskPulseWidget` with an `assigneeId` prop (compact variant); drop `MyTasksWidget` from the trainer dashboard.
- Sessions: source field (`auto`/`manual`/`booked`) from `pt_auto_attendance_log` link; extract `TodaySessionsCard`, `MyClientsCard`, `TrainerClassDays` components out of `TrainerDashboard.tsx` (672 lines).
- Avatars: members' photos via existing member avatar resolver (`resolveMemberDisplay`), signed URLs where private.
- Classes: date strip uses `istDateKey`/`labelForDateKey` from `src/lib/classes/schedule.ts`; session query filtered by `trainer_id`.
- Classes RBAC: in `Classes.tsx` derive `isTrainerOnly`; scope tabs/stats; migration adding a trigger/RLS check on `class_templates` and `classes` so trainer-role writes require `trainer_id` = caller's trainer id (managers/owners bypass), plus setting gate.
- Tests: `gateLabel` never returns serial; trainer can't save a rule for another trainer; date grouping of classes by IST day.
- Verify with Playwright as owner and as a trainer (mobile 375px + desktop), and run the design-critic pass.
