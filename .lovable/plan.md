## Audit findings

**1. `column "status" does not exist` toast (Calculate Run / Process All)**
- `payroll_create_run(p_branch_id, ...)` in migration `20260501184350_*` does:
  ```sql
  SELECT user_id FROM employees WHERE status = 'active' ...
  UNION
  SELECT user_id FROM trainers  WHERE status = 'active' ...
  ```
- Neither `employees` nor `trainers` has a `status` column — they have `is_active` (and now `exit_date`). So every Calculate Run / payroll bootstrap fails silently with the toast you see in the screenshot.
- Fix: rewrite the SELECTs to `WHERE is_active = true AND exit_date IS NULL`.

**2. PF deducted at hard‑coded 12% with no toggle**
- `calculatePayrollForStaff()` (src/services/hrmService.ts:417) does
  `pfDeduction = round(proRatedPay * 0.12)` unconditionally.
- The Payroll table header is literally "PF (12%)".
- `hr_settings` has **no** PF columns at all → the user has no way to disable it.
- Fix: add PF config to `hr_settings`, default **OFF**, surface in HR Settings, and respect it in the calculator + payslip + payroll RPC.

**3. Salary computed without attendance**
- `compute_payroll()` walks every day in the period. For each day with **no shift, no leave, no holiday**, it currently returns `payable = true` for "weekly_off" (Sundays only because of the `DOW=0` fallback) and `payable = false` for "absent" — but the bigger issue is **how the UI uses it**:
  - When attendance has never been marked, `payableDays = 0` (good), but we still render the row with `Process` enabled, **PT commission still flows in**, and a payslip can be generated for ₹0/full PF. That is what makes the screenshot confusing (Bhagirath shows 4/31 because MIPS pushed 4 punches; everyone else who never punched would show 0/31 yet still be "processable").
- Fix:
  - Treat staff with `payableDays = 0` AND `attendance rows = 0` as **"Attendance not recorded"** — block Process, show a warning chip, and offer one‑click "Mark full month present" / open Adjust drawer.
  - Add a **manual override** flow per row (already half‑built via `payroll_adjust_item` RPC) — currently unreachable from the UI. Surface it.

**4. No "automated" payroll lifecycle**
- `payroll_create_run` / `payroll_review_items` / `payroll_approve_run` / `payroll_process_items` / `payroll_mark_paid` already exist but are bricked by bug #1.
- There's no cron, no month‑close automation, and the "Process All" button in the visible card just toasts — it does not actually call any RPC.

---

## Plan

### A. Database migration

1. **Fix `payroll_create_run`** — replace `status = 'active'` with `is_active = true AND exit_date IS NULL` for both `employees` and `trainers`.
2. **Add PF + statutory config to `hr_settings`**:
   ```
   pf_enabled            boolean  NOT NULL DEFAULT false
   pf_employee_pct       numeric(4,2) NOT NULL DEFAULT 12.00
   pf_wage_ceiling       numeric        DEFAULT 15000   -- statutory cap, nullable
   esi_enabled           boolean  NOT NULL DEFAULT false
   esi_employee_pct      numeric(4,2) NOT NULL DEFAULT 0.75
   pt_enabled            boolean  NOT NULL DEFAULT false   -- professional tax
   pt_amount             numeric        DEFAULT 200
   tds_enabled           boolean  NOT NULL DEFAULT false
   ```
3. **New RPC `payroll_process_all(p_run_id, p_item_ids?)`** — wraps approve + process + audit in one txn for the "Process All" button.
4. **New RPC `payroll_mark_full_present(p_user_id, p_period_start, p_period_end, p_reason)`** — inserts synthetic "manual_present" rows into `payroll_run_lines` / overrides per item, so HR can salvage a month where MIPS attendance was missed.
5. Extend `payroll_summarize` / `compute_payroll` consumers to read `hr_settings` and compute `pf`, `esi`, `pt` as separate deduction columns instead of baking PF into client code.

### B. Backend — service layer

`src/services/hrmService.ts`
- Load `hr_settings` once per `calculatePayrollForStaff` call (cached via TanStack at the page level).
- Replace hard‑coded `0.12` with:
  ```ts
  const pfBase = settings.pf_wage_ceiling
    ? Math.min(proRatedPay, settings.pf_wage_ceiling)
    : proRatedPay;
  const pfDeduction = settings.pf_enabled
    ? Math.round(pfBase * (settings.pf_employee_pct / 100))
    : 0;
  ```
- Same pattern for ESI / PT.
- Return `attendanceRecorded: boolean` so the UI can lock rows where it's `false`.

### C. Frontend

**HR Settings → new "Statutory & Payroll" section** (`HrSettingsTab.tsx`)
- Switches: Enable PF, Enable ESI, Enable Professional Tax.
- Numeric inputs (disabled when switch off): employee %, wage ceiling, PT slab.
- Save persists via existing `hr_settings` upsert.

**HRM → Payroll tab** (`HRM.tsx` + `PayrollRunPanel.tsx`)
- Column header label: `PF` instead of `PF (12%)` (driven by settings; show actual % in a tooltip). Hide the column entirely when no statutory deduction is enabled.
- Per‑row guard:
  - If `attendanceRecorded === false`: replace Process button with an **amber pill "Attendance not recorded"** plus a `…` menu with:
    - "Mark full‑month present" (calls new RPC, asks for reason)
    - "Edit manually…" (opens adjust drawer)
    - "Skip this month"
- New right‑side **`AdjustPayrollItemSheet`** (Sheet, per project rule)
  - Fields: payable days override, OT hours, bonus, advance, penalty, deductions, reason (required).
  - Calls existing `payroll_adjust_item` RPC.
- "Process All" button now actually:
  1. Calls `payroll_create_run` if no draft run exists for the period.
  2. Calls `payroll_approve_run` + `payroll_process_items` for all `attendanceRecorded` items.
  3. Skips and lists rows still flagged "attendance missing" in a toast summary.
- Add a small **automation card** above the table:
  - "Automatic monthly close: 1st of each month at 02:00 IST" with a toggle (writes to `automation_rules` — already in this project).

### D. Automation (cron)

- New `automation_rules` row `payroll_month_close`:
  - Worker function `payroll-month-close` (edge fn) → for each branch, calls `payroll_create_run(prev_month)`, leaves it in `calculated` state for HR review (does **not** auto‑pay).
  - Dispatched by the existing `automation-brain-tick` master cron.

### E. UI polish (Vuexy)

- Rounded‑2xl cards, indigo/violet primary actions, amber warning chip for "Attendance missing", emerald success badge after Process, slate skeletons while `compute_payroll` runs.
- Sticky table header, hover row, right‑side Sheet for adjust — no Dialog.

---

## Acceptance criteria

- Clicking **Calculate Run** in May 2026 no longer toasts `column "status" does not exist`; a `payroll_runs` row is created and `payroll_items` populated for all active employees + trainers.
- With PF disabled in HR Settings → Statutory: PF column hides, payslip PDF omits PF line, Net = Gross for everyone.
- Enabling PF at 12% reproduces the current numbers exactly.
- A staff member with **zero attendance rows** for the month shows an amber "Attendance not recorded" chip and the Process button is disabled until either attendance is added or "Mark full‑month present" is used (with reason captured in `payroll_audit`).
- Manual adjust drawer writes to `payroll_audit` and re‑computes net.
- Monthly automation creates next month's draft run automatically; nothing is paid without HR clicking Process.

## Out of scope
- ESI / PT / TDS calculation engines beyond a flat-percentage placeholder (full slab logic is a follow‑up).
- Bulk bank file (NEFT) export.
- Form 16 / Form 24Q generation.