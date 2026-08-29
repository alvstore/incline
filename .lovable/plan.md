# Staff Attendance: Full Datetime Shift Pipeline

The punch pipeline you drew is mostly live already (hardware time → previous-night candidate → today's candidate → override → weekly roster → block → grace → late → save). Three steps of that chain are still approximate. This plan closes them.

## What is already correct (verified live)

- Real hardware scan time is used (shared MIPS parser, both webhook and reconciliation call `staff_record_punch`).
- Date override wins over the weekly roster, and inherits its grace.
- Dual-shift selection uses a configurable pre-shift window plus a midpoint rule, so a 16:57 punch resolves to the 18:00 evening block and is on time.
- One row per (user, shift date, block); repeat scans are ignored.

## Gaps to fix

### 1. Scheduled start/end are not real datetimes
`staff_attendance` stores only `scheduled_start` as a bare `time`, and no scheduled end at all. Lateness is computed by subtracting two times-of-day and then patching midnight wrap with a "+1440 if less than -720" rule. That heuristic is the last place a night or early-arrival punch can still produce a wrong number.

Fix: resolve and persist true timestamps.
- Resolver returns `scheduled_start_at` and `scheduled_end_at` (timestamptz, built from the resolved shift date + block times in IST, with the end rolled to the next day when the block wraps midnight).
- New columns `scheduled_start_at` / `scheduled_end_at` on `staff_attendance`, backfilled from existing `shift_date + scheduled_start`.
- `late_minutes = check_in - scheduled_start_at` in whole minutes, no wrap heuristic. Negative means early.
- `scheduled_start` (time) is kept and still written so existing UI and payroll queries keep working.

### 2. Candidate selection short-circuits instead of choosing the best
Today the previous day's night block wins immediately if the punch time falls before that block's end. It is never compared against today's own candidate. On a roster where someone works a night block and also has an early morning block the next day, an early-morning punch can be swallowed by yesterday's night shift.

Fix: build both candidates (previous-night, today's block), then pick the one whose scheduled window the punch actually falls in — or, if neither, the one with the smallest distance to its scheduled start within the pre-shift window. Ties go to the current day.

### 3. Grace default disagrees between layers
The resolver falls back to 15 minutes; the stamping trigger falls back to 10. A punch can be flagged late by one number and reported with another.

Fix: the trigger uses the resolver's `grace_min` only — single source, roster > branch HR setting > 15.

## Verification before this is called done

Run against Puneet's real 06:00–11:00 / 18:00–22:00 roster and Govind's 07:00–11:00 / 17:00–22:00:

- 05:55, 06:16, 17:57, 18:16, 20:00 → morning-early, morning-late-1, evening-early, evening-late-1, evening-late
- overnight 21:00–06:00 roster: 21:05 and 02:30 punches attach to the same shift date, second one is not a late arrival
- weekly off and no-roster days → unscheduled policy path, `late_minutes` null
- date override replacing a weekly block, with and without a matching weekly row (grace fallback)
- same punch replayed through webhook and reconciliation → exactly one row

## Technical notes

- One additive migration: `hr_settings` unchanged; `staff_attendance` gains two nullable timestamptz columns; `resolve_staff_shift` gains two output columns; `tg_stamp_staff_attendance_shift` rewritten to use them.
- `notify_late_attendance` keeps reading stored `late_minutes` / `is_late`, so notification wording is unchanged.
- No edge function or UI change is required; `StaffAttendanceBoard` already renders shift type, scheduled start, lateness and source.
