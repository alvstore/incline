# Dual-Shift Attendance, Payroll Accuracy & Member History

## What's wrong today (verified)

**1. Dual shifts are recorded but never judged.**
`staff_attendance` already stores one row per roster block (`shift_type` = morning / evening / night / full_day) — August data shows 75 morning, 18 evening, 15 night, 17 full-day rows. But the payroll function `compute_payroll` collapses the whole day: it takes `MIN(check_in)` / `MAX(check_out)` across all blocks and compares against a single `shift_start = COALESCE(morning_start, evening_start)`. A trainer rostered morning + evening who only shows up in the morning is still marked **present, full day, payable**. Nothing anywhere flags the missed evening block.

**2. Hours are fiction.** Staff attendance is check-in-only; the `auto_close_stale_staff_attendance` cron stamps a synthetic check-out. Every August row has a check-out, and durations come out at 14–17 h/day (Bhagirath: 427.7 h over 15 days ≈ 28 h/day). Payroll `hours_worked`, OT and half-day thresholds are all computed off this fake number.

**3. No UI to manage a block.** The Staff Check-in tab (screenshot 1) shows one row per person with one status and one "Check In" button. There is no per-block view, no way to mark the evening block absent/on-leave, no way to say "came morning, skipped evening".

**4. History tab is staff-only.** `historyStaffSummary` is built purely from `staff_attendance`; `member_attendance` never appears in a history view anywhere in the app.

## What we'll build

### A. Per-block truth in the database
- New helper `staff_day_blocks(user_id, date)`: returns every rostered block for the day (morning / evening / night / full_day) with scheduled start-end, plus the matching attendance row if any → `attended | missed | pending`.
- Rewrite `compute_payroll` to iterate blocks instead of days:
  - `rostered_blocks` vs `attended_blocks` per day.
  - **Attendance fraction** = attended / rostered. 1 of 2 blocks → **half day** (`status = 'half_day'`, `payable_fraction = 0.5`), matching your rule. 0 of N → absent. All blocks → full day.
  - **Hours**: use the real check-out when it is a genuine punch; otherwise fall back to the rostered block duration. Auto-closed rows are treated as "no check-out" (they carry `source`/notes from the cron) so the 28 h/day inflation disappears.
  - Lateness stays per block, using each block's own scheduled start (already stamped on the row).
- Add `payroll_run_lines.payable_fraction`, `blocks_rostered`, `blocks_attended` so payroll runs record *why* a day was half paid.
- New RPC `staff_mark_block(user_id, date, shift_type, state, reason)` for manager overrides: mark a block **absent**, **on leave**, or record a **manual late check-in**, fully audited (`recorded_by`, notes) and RBAC-gated to owner/admin/manager, never self.

### B. Attendance dashboard redesign (2026 Vuexy)
- **Staff Check-in tab → Roster board.** One card per staff member, expanded into their rostered blocks for the day: each block is a chip with scheduled window, actual in-time, on-time/late badge, and its own action (Check in · Mark absent · Mark leave · Correct). A morning-present / evening-missed trainer reads as **Half day · evening missed** with an amber badge, not "Present".
- Day summary strip: Full day · Half day · Absent · Late · Unscheduled counts.
- **History tab → two segments: Staff | Members.**
  - *Staff*: monthly grid with corrected metrics — Full days, Half days, Absent, Late, Payable days, Hours (real vs rostered clearly labelled). Click a card → per-day drill-down showing each block's status. Export CSV.
  - *Members*: summary cards (visits this month, last visit, avg duration, current streak) **plus** an expandable day-by-day log with date-range, source and duration filters and search by name / member code / phone. Export CSV.
- All new surfaces get skeletons, empty states, error fallbacks, `aria-label`s on icon buttons, and 44 px touch targets.

### C. HRM payroll screen
- Payroll run lines show Full / Half / Absent with the block breakdown and payable fraction.
- Half days visibly reduce the payable-day total; an "Hours are rostered (no real check-out)" note appears where the fallback was used.
- Manager can jump from a payroll line to that day's block board to correct a punch, then re-run.

## Technical notes
- Migration: new/updated functions `staff_day_blocks`, `compute_payroll`, `staff_mark_block`; new columns on `payroll_run_lines`; index on `staff_attendance(user_id, shift_date)`.
- Auto-close rows are identified so they never count as real check-outs; the cron itself stays untouched.
- Frontend: rework `src/pages/AttendanceDashboard.tsx` (staff-record + history tabs), extend `src/components/attendance/StaffAttendanceBoard.tsx`, new `MemberAttendanceHistory.tsx`, new hooks `useStaffDayBlocks` / `useMemberAttendanceHistory` (TanStack Query, branch-scoped, invalidated on mutation).
- No recalculation of already-approved payroll runs; the new logic applies to new runs and to on-screen previews.

## Out of scope
- Changing the check-in-only model to mandatory check-out.
- Salary component/CTC changes — only day classification and hours feed payroll.
