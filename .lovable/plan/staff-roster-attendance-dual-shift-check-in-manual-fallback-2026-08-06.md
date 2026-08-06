# Staff Roster & Attendance: Dual-Shift Check-In, Manual Fallback, MIPS Reconciliation

## What the audit found (verified against live data and code)

- The roster model already supports single **and** dual shifts: `staff_shifts` has `morning_start/end` + `evening_start/end` per weekday, `staff_shift_overrides` handles one-off dates, and `resolve_staff_shift()` picks the block a punch belongs to. 57 weekly rows and 3 overrides exist.
- **The gate is destroying the second shift.** `mips-webhook-receiver` looks back 18 hours for any open `staff_attendance` row and, if it finds one, writes `check_out` instead of opening a new row. So a trainer's evening punch closes their morning row rather than recording an evening check-in. Result: the gate logged ~150 staff punches/day between 28 Jul and 6 Aug, but `staff_attendance` holds only 8–13 rows/day, and almost every row is "closed" by a punch that was really an arrival. Since check-out is explicitly out of scope, this toggle logic is simply wrong.
- The unique index `staff_attendance_one_open_per_shift_uidx (user_id, shift_type) WHERE check_out IS NULL` assumes checkouts exist. With check-in-only, a second punch in the same block would collide instead of being ignored.
- Lateness plumbing is in place (`scheduled_start`, `late_minutes`, `is_late`, `tg_stamp_staff_attendance_shift`, `notify_late_attendance`, `LatePolicySheet`) but it is fed by punches that landed on the wrong shift, so the numbers on the roster grid and in alerts can't be trusted yet.
- Manual entry exists only as a thin "staff-record" tab inside `AttendanceDashboard.tsx` (search a person, toggle check-in). There is no shift-aware view: no "who is expected on shift now vs who punched", no way to correct a wrong punch time, no reason/audit trail, no dual-shift awareness.

## Plan

### 1. Check-in-only attendance model (no check-out)
- One `staff_attendance` row per person per **resolved shift block** per day (`shift_date` + `shift_type`). Morning and evening blocks are separate rows, so dual-shift staff get two check-ins a day and single-shift staff get one.
- A repeat punch inside the same block updates nothing (recorded as a gate event only) — it never writes `check_out` and never raises a second late alert.
- Replace the open-row unique index with a unique index on `(user_id, shift_date, shift_type)` so the block, not the checkout state, enforces uniqueness.
- `check_out` stays in the schema untouched for the future; nothing writes it automatically anymore.

### 2. Fix the MIPS receiver
`mips-webhook-receiver`'s `handleStaffCheckin` is rewritten: resolve the block for the punch, upsert the block's row if absent, otherwise ignore as a duplicate. The 18-hour "close the open row" branch is removed. Gate response messages become "Morning check-in recorded" / "Evening check-in recorded" / "Already marked present for this shift".

### 3. Reconcile actual attendance up to 6 Aug 2026
A one-off backfill rebuilds `staff_attendance` from the gate's own record (`access_logs` staff punches, `profile_id` not null) for 28 Jul – 6 Aug 2026:
- Group each person's punches by resolved shift block, keep the earliest punch of each block as the check-in.
- Recompute `shift_type`, `scheduled_start`, `late_minutes`, `is_late`, `shift_date`.
- Clear the `check_out` values that were really arrivals, so payroll hours are not fabricated from a toggle.
- Rows created manually (no matching gate punch) are preserved and flagged `manual`.
- A before/after count per person per day is produced so you can eyeball the correction before it is kept.

### 4. New Staff Attendance workbench (UI/UX)
A dedicated shift-aware screen at `/attendance` (staff tab) and linked from Staff Roster, built with the ui-ux-pro-max audit against the Vuexy system:
- **Now strip** — expected-on-shift right now, present, late, missing; each as a KPI on the indigo/violet gradient hero.
- **Day board** grouped by block (Morning · Evening · Unscheduled), one row per rostered person showing scheduled window, actual punch time, source badge (Gate / Manual), and a status badge (Present · Late · Absent · Weekly off · Unscheduled).
- **Mark present** inline for anyone missing — opens a right-side sheet with person, block, date, exact time picker (backdating allowed), reason, and notes.
- **Correct a punch** on any existing row: change the time or move it to the other block, with a mandatory reason; the original value is kept in the audit log.
- Skeletons, empty state, error state, `aria-label` on every icon button, 44px targets, responsive down to 375px.

### 5. Roster clarity for single vs dual shift
On `StaffRoster.tsx`, each cell shows the block(s) explicitly with a "Dual" or "Single" chip, weekly off styled distinctly, and one-off overrides keep their existing badge. The attendance-log tab reads the stored `late_minutes`/`is_late` instead of recomputing, so roster, notifications and payroll agree.

### 6. Notifications sanity
`notify_late_attendance` fires once per block, uses the block's own scheduled start and effective grace, and stays silent for weekly-off/unscheduled days and for the backfill run.

## Technical notes

- Migration: drop/replace `staff_attendance_one_open_per_shift_uidx`; add `source` (`gate` | `manual` | `backfill`) and `recorded_by` to `staff_attendance`; new `staff_mark_attendance(user_id, branch_id, at, shift_type, reason)` and `staff_correct_attendance(id, new_at, new_shift_type, reason)` RPCs (audited); backfill statements scoped to 2026-07-28 → 2026-08-06 IST.
- Edge function: `supabase/functions/mips-webhook-receiver/index.ts` — rewrite `handleStaffCheckin` (version bump), keep the min-punch-gap setting as the duplicate guard.
- Frontend: new `src/components/attendance/StaffAttendanceBoard.tsx`, `MarkAttendanceSheet.tsx`, `CorrectPunchSheet.tsx`; `AttendanceDashboard.tsx` staff tab swapped to the board; `StaffRoster.tsx` cells + attendance log updated; `useMyShiftWeek.ts` and `MyShiftWeekCard.tsx` read stored late values and show both blocks.
- All time maths in `Asia/Kolkata`; all queries via TanStack Query and branch-scoped; financial/payroll views unchanged in this pass.
