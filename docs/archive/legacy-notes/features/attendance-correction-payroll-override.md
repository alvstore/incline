---
name: HR attendance correction & payroll override workflow
description: Server RPCs and UI rules for correcting staff attendance and recalculating payroll without a parallel attendance system
type: feature
---

All staff attendance edits go through SECURITY DEFINER RPCs — never direct table writes:

- `staff_mark_manual_attendance(user, date, shift_type, check_in, check_out, reason, branch)` — creates a punch for a rostered block that has none. Defaults check-in/out to the roster block (overnight end rolls +24h), rejects duplicates for (user, date, shift_type), clears any absent/leave mark.
- `staff_correct_attendance(id, check_in, notes, check_out, shift_date, reason, clear_check_out)` — the only correction path; re-firing `check_in` lets `tg_stamp_staff_attendance_shift` recompute shift block, scheduled datetimes, lateness, and `tg_fill_attendance_total_hours` recompute hours. The client never computes lateness or hours.
- `staff_delete_attendance(id, reason)` — reason mandatory, stamped into notes before delete so the audit trigger captures it.
- `staff_mark_block(...)` — states limited to absent/leave/clear; weekly off stays a roster setting.

Authorisation: `assert_can_manage_staff_attendance(target)` — owner/admin anywhere, manager only for `staff_primary_branch(target)` in `user_visible_branch_ids`, nobody on their own attendance. All these functions have EXECUTE revoked from PUBLIC/anon.

Payroll: attendance/block-mark changes fire `tg_flag_payroll_attendance_change`, which sets `payroll_items.attendance_changed_at` for non-processed/paid runs. Nothing recalculates automatically. HR clicks Recalculate → `payroll_recalculate_item(item, reason)`; hand-adjusted or manual-full-present lines keep their final amounts and only refresh calc_* references. `payroll_reopen_run(run, reason)` (owner/admin) sends an approved run back to draft; processed/paid runs can never be reopened. Attendance UI must never write payroll amounts.

UI: `AttendanceDetailDrawer.tsx` (opened from any cell of the Staff Roster attendance matrix and reusable elsewhere) reads `staff_day_blocks` and requires a reason for every action.
