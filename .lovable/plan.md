# HRM: attendance editing, payroll rebuild, deductions

## What is wrong today (verified in the code and live data)

1. **Two payroll systems run side by side.** The Payroll tab renders the new *Payroll Run* panel (server-calculated lines, real approve/process/pay flow) and, underneath it, an old *Payroll Processing* table that recalculates everything in the browser. They disagree badly — for Bhagirath the run panel shows PT ₹2,171 while the old table shows ₹64,250, because they read commissions from two different sources. The old table's "Process" button only shows a success toast; it saves nothing.
2. **Advances are never deducted.** Gyaneshwar Athwal has ₹5,000 outstanding (paid 27 Aug) and Ritesh Sharma ₹1,000. The routine that builds a payroll run sets advance, penalty and statutory deductions to zero, so nothing is ever recovered unless a person hand-edits each line.
3. **August attendance/salary maths is inconsistent.** The day calculation treats any partially attended day as exactly half a day, ignoring the block-accurate fraction the day-by-day view shows; a day with no roster at all is counted as a fully paid "weekly off". The browser-side table uses the fraction instead, so the two views produce different paid days for the same month.
4. **No TDS is actually being deducted anywhere** — the only mentions are in the employment contract text ("PF, ESI, Professional Tax, TDS"). There is a `tds_enabled` flag in HR settings that is off, but it has no switch in the HR Settings screen, so nobody can see or control it.
5. **Attendance is duplicated.** Attendance has both a "Staff Log" tab (one day, shift-grouped) and a "History" tab (month summary + read-only day-by-day). The day-by-day drawer has no way to fix a missed gate punch, change a date, or pick morning/evening.

## What will change

### A. Attendance — one place, editable
- Remove the **Staff Log** tab; History becomes the single staff view.
- Day-by-day drawer becomes actionable: each day row shows the rostered blocks (morning / evening / night / full day) with attended vs missed state, and per block: **Mark present**, **Edit time**, **Mark absent / leave**, **Clear**, **Delete punch** — every action asks for a reason.
- Add a day picker + "add missed day" so a punch the gate never captured can be added on any past date with the correct shift block.
- Everything routes through the existing server routines (`staff_mark_manual_attendance`, `staff_correct_attendance`, `staff_mark_block`, `staff_delete_attendance`) so lateness, hours and audit history stay server-computed.
- The month card grid keeps its counters and refreshes after every edit.

### B. Payroll — one console
- Delete the old browser-calculated "Payroll Processing" table and the fake Process button. The Payroll tab becomes a single flow:
  **Choose month → Generate run → Review lines → Adjust → Approve → Process → Mark paid.**
- One clear line card per staff member: paid days (with a link back to that person's day-by-day), base, pro-rated, PT commission, advance recovery, other deductions, net — plus a badge when attendance changed after the run was generated, with a Recalculate action.
- A run header strip shows headcount, total gross, total deductions, total net, and how many lines are blocked (no attendance) so "Process all" is never ambiguous.
- PT commission comes only from the server routine already used by runs — no second source.

### C. Deductions and TDS
- HR Settings gets a **Statutory deductions** section with explicit switches: PF, ESI, Professional Tax, **TDS** (default off, off today) — each with its rate field, and plain wording that nothing is deducted while a switch is off.
- Contract wording becomes conditional: only the deductions actually enabled are listed, so contracts stop promising TDS.
- Advance recovery becomes part of run generation: outstanding advances are deducted (capped at net pay, and capped per month if a limit is set), shown as their own line, and the advance ledger is closed out only when the payslip is marked paid.

### D. Attendance → salary maths
- Paid days use the block-accurate fraction (1 of 2 rostered shifts = 0.5, 2 of 3 = 0.67) everywhere, instead of forcing 0.5.
- A day with no roster and no punch is no longer silently paid as a weekly off; weekly off is taken from the roster's off-day setting, and days with neither roster nor punch are flagged for HR rather than paid.
- The denominator for pro-rating is stated on screen (calendar days in month) so the number can be checked by hand.
- August will be re-verified line by line for the affected staff after the fix; existing draft runs can be recalculated, processed/paid runs are left untouched.

### E. Trainer Commission Ledger (PT)
- The ledger currently loads **every PT package ever sold** with no period control. It gets a month selector (and a custom range) matching the payroll month, so August shows only August sales, with the summary tiles recalculated for that month.
- The "GST" column is actually the flat 5% cut applied to non-cash sales — that deduction is switched off by default and only applies if the matching statutory switch is enabled in HR Settings; the column is renamed to what it really is, and shows "—" when nothing is deducted.
- Each row keeps its instalment strip, with the instalment falling in the selected month highlighted so the payroll figure is traceable.


## Technical notes
- Database: rewrite `payroll_summarize` (use `payable_fraction`, correct weekly-off detection), extend `payroll_create_run` / `payroll_recalculate_item` to fill `calc_deductions` (PF/ESI/PT/TDS from `hr_settings`) and `final_advance` from `salary_advances.outstanding`, and grant execute on `staff_day_blocks` where needed for the summary path.
- Frontend: delete the `staff-log` tab and `StaffAttendanceBoard` usage in `AttendanceDashboard.tsx`; extend `StaffMonthHistory.tsx` day drawer to reuse `AttendanceDetailDrawer.tsx`; remove the legacy payroll table and `calculatePayrollForStaff` from `HRM.tsx` / `hrmService.ts`; rebuild `PayrollRunPanel.tsx` as the single console; add the statutory section to `HrSettingsTab.tsx`; make `contractTemplateV2.ts` deduction wording conditional.

## One thing I need
The reference Excel for August was mentioned but did not come through — only screenshots arrived. Send the sheet and I will reconcile every August line against it after the fix; otherwise I will reconcile against the roster and gate punches.
