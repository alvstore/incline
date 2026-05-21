## Audit findings — Payroll Processing table

### 1. Conflict / duplicate logic (CRITICAL — shown across both screenshots)

The two screenshots aren't just a "loading flash" — they expose a real **business-rule conflict**:

- **Image 1 (initial fallback render)** — every row shows `0/26`, `₹0` net pay. This is the placeholder injected in `HRM.tsx:250` when `calculatePayrollForStaff` throws (`workingDays: 26` is hardcoded — May has 31 days, so the default is already wrong).
- **Image 2 (after query resolves)** — same rows now show `4/31`, prorated `₹3,226`, *and* an amber **"Attendance not recorded"** chip on the same line.

Root cause in `compute_payroll` RPC + `hrmService.calculatePayrollForStaff`:
- The RPC walks every calendar day and returns `payable=true` for non-Sunday/non-leave days even when **no `staff_attendance` row exists**. So `payableDays` accumulates from shift-template / default-working-day logic, not from actual punches.
- `attendanceRowsTotal` only increments when `hours_worked > 0`. That's the value driving the `attendanceRecorded` flag.
- Result: the warning chip says "no attendance" while the prorated column simultaneously credits ₹3,226. The user sees two contradictory truths in one row, and a manager could hit **Process** and pay a no-show staff member.

This is the duplicate/conflict the user is asking us to remove.

### 2. Initial-flash UX issue
The 0/26 → 4/31 flicker happens because the empty-result fallback is rendered as real data instead of a skeleton. There is no per-row loading state — only the page-level staff list shows a spinner.

### 3. Badge styling issue (visible in image 2)
Line 1321:
```
<Badge variant="outline" className="text-[10px] px-1 py-0 bg-amber-500/10 text-amber-700 border-amber-500/30">
  ⚠ Attendance not recorded
</Badge>
```
- Sits inside a narrow `Days` column with `flex-col`, so the long label wraps into a tall pill (looks like a stadium/oval blob in the screenshot).
- Uses an emoji `⚠` (violates project rule: lucide-react only, no emoji).
- `text-[10px]` + `px-1 py-0` is too cramped; outline + soft amber tint feels weak against the dense table.
- Color tokens are raw Tailwind (`bg-amber-500/10`) instead of semantic Vuexy tokens.

---

## Plan

### A. Backend logic fix — `src/services/hrmService.ts`

When `attendanceRecorded === false` AND the row hasn't been manually overridden via `payroll_mark_full_present`, zero out the payable side so the UI and the database agree:

```ts
const hasManualOverride = dailyBreakdown.some(r => r.source === 'manual_override');
if (!attendanceRecorded && !hasManualOverride) {
  payableDays = 0;
  // proRatedPay, grossPay, deductions, netPay all become 0
}
```

This keeps `payroll_mark_full_present` as the single, audited path to credit a full month when attendance was genuinely missed. No silent auto-payment.

Also fix the fallback default in `HRM.tsx:250`: replace hardcoded `workingDays: 26` with `getDaysInMonth(payrollMonth)` so the placeholder matches reality.

### B. Per-row loading state — `src/pages/HRM.tsx`

- Track `isLoading` from the `hrm-payroll` query and, while pending, render `<Skeleton>` cells for Days/Pro-rated/Gross/Deductions/Net Pay instead of zeros. Eliminates the 0/26 → 4/31 flash.
- Keep Process / download / email action buttons disabled during load.

### C. Badge redesign — replace the amber blob

New component `src/components/hrm/AttendanceStateBadge.tsx`:

- Uses `AlertTriangle` from lucide-react (no emoji).
- Inline chip: `inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap`.
- Tooltip on hover: "No check-ins recorded for this period. Use 'Mark full month present' or sync MIPS attendance before processing."
- Days cell layout changes from `flex-col` to a tight 2-line stack: `font-mono` "0/31" on top, single-line chip below — no wrapping.

When the override has been applied, swap to a green chip: `Manually marked present` with `CheckCircle2` icon, same shape.

### D. Process-row guard

`Process` button (and `Process All`) becomes disabled with a tooltip when **any** visible row has `attendanceRecorded === false && !manualOverride`. Prevents accidental zero-attendance payouts.

### E. Files touched

- `src/services/hrmService.ts` — zero-out logic + override detection.
- `src/pages/HRM.tsx` — fallback fix, skeletons, Process All guard, badge swap.
- `src/components/hrm/AttendanceStateBadge.tsx` — new.

### Out of scope
- Server-side `compute_payroll` SQL rewrite (would require migration; current frontend gate is sufficient and reversible).
- Manager/Owner bulk "Mark full month present" — already exists per row.
- ESI/PT calculation engine changes.

### Acceptance
- No flicker: rows show skeleton then final values in one transition.
- No row simultaneously shows "Attendance not recorded" and a non-zero Net Pay.
- Badge renders as a single-line pill with a lucide icon, matches Vuexy density.
- `Process` / `Process All` blocked while any row is in unrecorded state.

Used the senior-architect and ui-ux-pro-max skills.