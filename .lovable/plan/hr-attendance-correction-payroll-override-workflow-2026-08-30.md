# HR Attendance Correction + Payroll Override Workflow

Make every cell in the monthly attendance matrix actionable, with server-side correction RPCs, a full audit trail, overnight-safe logic, and a controlled path from attendance changes into the existing payroll engine.

## What the audit found (verified live)

- `staff_day_blocks(user_id, date)` already returns, per roster block: shift type, scheduled start/end, `is_overnight`, attendance id, check-in/out, lateness, source, notes, block mark state/reason, rostered vs actual hours. This is the correct data source for the detail drawer — no new read function is needed.
- The attendance matrix in `StaffRoster.tsx` does **not** use it. It rebuilds cells in React from raw `staff_attendance` logs plus the weekly roster, so it never shows Leave or Absent block marks, ignores date overrides, and cells are read-only.
- `staff_correct_attendance(p_id, p_check_in, p_notes)` exists but cannot correct check-out or shift date. Derived fields recalc only through the `check_in` trigger.
- `staff_mark_block(user_id, date, shift_type, state, reason, branch_id)` exists; state validation and branch authorisation need review/tightening.
- There is **no** RPC to create a manual attendance record for an absent day.
- `staff_attendance` already has an `audit_log_trigger_function_nb` trigger writing to `audit_logs` — reuse it, no new audit table.
- Payroll chain exists and stays untouched: `compute_payroll`, `payroll_summarize`, `payroll_create_run`, `payroll_adjust_item`, `payroll_mark_full_present`.
- Kunal Prajapat **already has** recurring shifts: Mon–Sat 21:00→06:00, Sun 22:00→10:00, no weekly off, plus 2 historical overrides. Per your answer this stays exactly as is — no roster writes. It is used only as the overnight regression fixture.

## Phase A — Database

Migrations, shown for approval before running.

1. **`staff_mark_manual_attendance(p_user_id, p_branch_id, p_shift_date, p_shift_type, p_check_in, p_check_out, p_reason)`** — new SECURITY DEFINER RPC.
   - Authorises owner/admin, or manager with access to the target's branch; re-derives the employee's branch server-side and ignores a mismatched `p_branch_id`.
   - Resolves the roster block for the date (override → weekly roster), builds true `scheduled_start_at` / `scheduled_end_at` datetimes with the overnight +24h rule, computes `late_minutes`, `is_late`, `total_hours`.
   - Sets `source='manual'`, `recorded_by`/`corrected_by`=`auth.uid()`, `corrected_at=now()`.
   - Unique per `(user_id, shift_date, shift_type)` — a duplicate is rejected with a clear message, not silently upserted.
   - Clears any conflicting `staff_block_marks` absent/leave row for that block.
   - Returns the attendance id.
2. **`staff_correct_attendance`** extended to `(p_id, p_check_in, p_check_out, p_notes, p_shift_date, p_reason)`, keeping the existing signature working. Recalculates scheduled start/end datetimes, lateness and hours on every correction so no stale values survive.
3. **`staff_mark_block`** hardened: allowed states restricted to `absent`, `leave`, `clear`; owner/admin/branch-manager check; records `marked_by`, `reason`, `created_at`. Weekly off is explicitly rejected here.
4. **`staff_delete_attendance`** gains a required reason and the same branch check.
5. **Payroll staleness signal** — `payroll_items` gets `attendance_changed_at`; a trigger on `staff_attendance` and `staff_block_marks` stamps it on any non-paid run item whose employee/period covers the changed date. No payroll amount is ever written by attendance code.
6. **`payroll_reopen_run(p_run_id, p_reason)`** — owner/admin only, approved → draft, audited, refuses processed/paid runs.

All existing payroll audit rows and historical attendance stay untouched.

## Phase B — Attendance Details drawer

New `AttendanceDetailDrawer.tsx` (Sheet, `sm:max-w-lg`, full width on mobile), fed by `staff_day_blocks`:

- Header: staff name, date, branch.
- Per roster block: scheduled window, an explicit "Shift belongs to 12 Aug and ends 13 Aug" line for overnight blocks, state badge (Present / Late / Absent / Leave / Weekly off / Unscheduled / Pending), check-in, check-out, hours, late minutes, source.
- Actions gated by `can.*` + branch: Mark Present, Mark Leave, Mark Absent, Correct check-in / check-out / notes, Remove record. Weekly off is not an action here — it links to the roster override editor instead.
- Reason field required for every write.
- Correction History from `audit_logs` for that attendance row: actor, timestamp, old → new state and times, reason. Read-only.

## Phase C — Matrix cells become actionable

`AttendanceMatrix` switches to a month-wide block-state source so Leave, block-marked Absent and roster overrides render correctly, instead of the current React-side inference. Cells get `cursor-pointer`, hover ring, keyboard focus, `aria-label`, and open the drawer. Badges/legend gain Leave and Pending. No visual redesign otherwise.

## Phase D — Payroll attendance review

- Each payroll item row gains an **Attendance** summary (present / late / half day / absent / leave / weekly off / OT hours) and a **Review Attendance** action that opens the attendance matrix filtered to that employee and payroll period.
- The same summary appears inside the payroll item preview drawer.
- Clear separation in the UI: "Correct attendance" (fixes facts) vs "Payroll adjustment" (money), with copy stating adjustments must not be used to hide attendance errors.

## Phase E — Recalculation and locking

- Draft / calculated / reviewed runs: if `attendance_changed_at` is newer than the item's calc, show "Attendance changed after payroll was calculated" and a **Recalculate attendance** button. Recalculation is always explicit — never automatic.
- If the item was manually adjusted, recalculation shows a diff (old vs new calculated values, manual overrides listed) and requires confirmation before manual values are re-based.
- Approved: warning + **Reopen run** (owner/admin, reason, audited).
- Processed / Paid: attendance corrections are still allowed as a record of fact but cannot touch that run; the UI states "Payroll already paid — create a payroll adjustment on the next run."
- `payroll_mark_full_present` stays, exposed with a before/after preview (e.g. 3 present / 27 absent → 30 payable), required reason and a strong warning that day-by-day correction is preferred.

## Phase F — Tests

`supabase/tests/` SQL plus service-level tests covering the 20 listed cases, with emphasis on: cross-branch and cross-employee denial, duplicate manual attendance rejection, overnight 21:00→06:00 assigned to the start date, 05:50 next-morning not creating a second late/absence, lateness and hours recalculated after corrections, leave and weekly off not counted as absence, paid payroll immutability, and manual adjustments surviving a refresh with warning.

## Verification

Build + typecheck + ESLint on changed files, RPC verification via SQL against the Kunal overnight fixture and a dual-shift fixture, and a payroll recalculation round-trip on a scratch draft run. No warnings will be disabled to make output look clean.
