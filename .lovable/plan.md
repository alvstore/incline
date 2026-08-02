# Staff Late Check-in: Align Attendance + Notifications with the Roster

## What the audit found (verified against live data and code)

- Every staff punch coming from the MIPS gates is written by `mips-webhook-receiver` **without a shift type**, so the column falls back to its default `full_day`. All 15 most recent rows are `full_day`.
- The late trigger (`notify_late_attendance`) resolves the scheduled start as `morning_start` whenever the row is not explicitly `morning`/`evening`. Ritesh Sharma's roster is morning 07:00–11:00 **and** evening 18:00–23:00; his 22:35 punch was compared against 07:00 → "935 min late". Bhagirath Gurjar (06:00–22:00) got the same treatment at 22:30 → "990 min late". Both alerts are false.
- The trigger reads only `staff_shifts` by weekday. It **ignores `staff_shift_overrides`** (per-date roster changes), so a legitimately shifted day still alerts.
- Grace is hard-coded to 10 minutes in three separate places (the trigger, `StaffRoster.tsx` `GRACE_MINUTES`, `useMyShiftWeek.ts`), even though `staff_shifts.late_grace_min` already exists per row and is never used. There is no settings UI anywhere for it.
- Because there is no check-out, MIPS punches toggle: a second gate scan the same day (after the stale-attendance auto-close) inserts a **new check-in row**, which fires another late alert. That is the source of the repeated evening alerts.
- Lateness is never stored — the roster matrix and My Shift card each recompute it with their own morning-first rule, so the roster, the notification and payroll can disagree.

## Plan

### 1. One roster resolver used by everything
Add a server function `resolve_staff_shift(user_id, punch_timestamp)` that returns the scheduled block for a punch:
- `staff_shift_overrides` for that exact date wins; otherwise `staff_shifts` for the weekday.
- If both a morning and an evening block exist, pick the block the punch actually belongs to (nearest start, with the evening block claiming anything from its start minus grace onward) instead of always morning.
- Handle blocks that cross midnight (end < start) so a 23:30 punch on a night shift is on-time, not 16 hours late.
- Return the resolved block, its start, and the effective grace.
- Weekly off / no scheduled block → no lateness, flagged as `unscheduled` rather than late.

### 2. Stamp the punch with its real shift
`mips-webhook-receiver` (and the manual `staff_check_in` RPC) will set `shift_type` from the resolver at insert time, so `full_day` stops being a silent default. Check-out behaviour stays exactly as it is today.

### 3. Stop duplicate punches from raising new "late" alerts
Within the same resolved shift block, a repeat gate scan is recorded as an access event but does **not** open a second attendance row and does **not** raise a second late alert. Only the first punch of a block counts for lateness. A configurable minimum gap between punches (default 60 min) covers rapid re-scans at the gate.

### 4. Store lateness instead of recomputing it three ways
Add `scheduled_start`, `late_minutes` and `is_late` to `staff_attendance`, filled by the trigger using the resolver. `StaffRoster.tsx`'s attendance matrix and `useMyShiftWeek.ts` then read those values, so the roster grid, the notification text and any payroll view always agree. Their local hard-coded 10-minute constants are removed.

### 5. Late-policy settings UI (new)
A new **Attendance & Late Policy** section, reachable from the Staff Roster header and from HR Settings, as a right-side sheet:
- Branch default grace period (minutes).
- Toggle: send late-check-in notifications; and who receives them (owners/admins always, branch managers optional).
- Minimum minutes between punches.
- Whether an unscheduled-day punch counts as late, on-time or unscheduled.
- Per-staff override of grace, edited inline on the roster row (writes `staff_shifts.late_grace_min`, which already exists).
Effective grace resolution order: per-staff shift → branch default → 10 minutes.

### 6. Fix the notification itself
Rewrite `notify_late_attendance` to use the resolver, the effective grace and the stored `late_minutes`, and to skip firing when notifications are disabled, when the punch is a repeat, or when the day is a weekly off/override off-day. Message becomes e.g. "Ritesh Sharma clocked in 12 min late for the evening shift (18:00) at INCLINE."

### 7. Clean up the false history
One-off backfill: recompute `shift_type`, `scheduled_start`, `late_minutes` and `is_late` for existing `staff_attendance` rows against the roster, and mark the already-sent bogus `staff_late` notifications (the 935/990-minute ones) as read so the bell reflects reality.

## Technical notes

- Migration: `resolve_staff_shift()` SQL function; new columns on `staff_attendance`; new late-policy columns on `hr_settings` (branch default grace, notifications enabled, min punch gap, unscheduled handling); rewritten `notify_late_attendance` trigger; backfill statements.
- Edge function: `supabase/functions/mips-webhook-receiver/index.ts` — resolve and stamp `shift_type`, apply the repeat-punch guard in `handleStaffCheckin`. Check-out logic untouched.
- Frontend: new `LatePolicySheet.tsx` under `src/components/hrm/`, wired into `StaffRoster.tsx` and `HrSettingsTab.tsx`; `StaffRoster.tsx` attendance matrix and `useMyShiftWeek.ts` switch to stored late values.
- All time maths stay in `Asia/Kolkata`, matching the existing trigger.
