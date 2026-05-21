## Audit findings

**Duplication is real.** Two routes render the same data with different polish:

| Surface | `/employees` (`EmployeesPage`, 569 LOC) | `/hrm` › Employees tab (`HRMPage`, 1178 LOC) |
|---|---|---|
| Data source | `employees` + `trainers` + `profiles`, aggregated by `user_id` into a single `StaffPerson` (dual-role aware) | `fetchAllPayrollStaff()` — same dedupe by `user_id`, but tuned for payroll |
| KPI cards | People / Managers / Trainers / Other / Active (5 cards, gradient tints) | Total Staff / Active / Active Contracts / Monthly Payroll (4 gradient cards) |
| Filters | Search + Role + Department + Status | Search only |
| Columns | Member · Roles · Code · Department · Position · Branch · Status · Hire Date | Member · Code · Type · Department · Position · Salary |
| Actions | Contract + Edit (icon) | Contract + Edit (icon) |
| Add Employee | ✅ header CTA | ✅ header CTA |
| Sub-nav | None | Employees · Contracts · Attendance · Payroll · Policies · HR Settings |

Both pages already query the **same tables**, both already **dedupe dual-role people** (manager who is also a trainer is one row), and both share `AddEmployeeDrawer` / `EditEmployeeDrawer` / `EditTrainerDrawer` / `CreateContractDrawer`. The split exists only because `/employees` is a newer, prettier reskin that never got merged back.

**Nav also duplicates:** `src/config/menu.ts` lists both HRM and Employees in the sidebar for owner/admin/manager AND manager. `navModules.ts` already groups `/hrm` and `/employees` under one module.

**Action-column gaps (both pages):**
- No "View profile" / drawer
- No "Deactivate / Reactivate"
- No "Reset password / Resend invite"
- No "Mark exit / offboard"
- No "Assign role" (promote staff → manager, attach trainer record)
- No bulk select
- Trainer + Employee edit live behind two different buttons (we can route by role automatically)

## Decision

**Keep `/hrm` as the single source of truth. Retire `/employees`.** HRM already owns Contracts, Attendance, Payroll, Policies, HR Settings — the people directory belongs in the same hub. The `/employees` page contributes the better directory UX (multi-role filters, role chips, branch column, KPI breakdown), which we'll port into HRM › Employees tab.

## Plan

### 1. Port the richer directory into HRM › Employees tab
Replace the current Employees tab body with the `/employees` layout:
- **5 KPI tiles** (People · Managers · Trainers · Other Staff · Active) using existing Vuexy gradient cards. Drop HRM's "Active Contracts" / "Monthly Payroll" tiles from this tab — they already exist on Contracts / Payroll tabs.
- **Filter bar:** Search · Role (All/Manager/Trainer/Staff) · Department · Status.
- **Table columns:** Staff Member · Roles (chips) · Code · Department · Position · Branch · Status · Hire Date · Actions.
- Use the unified `StaffPerson` aggregator from `EmployeesPage` (handles dual-role correctly).

### 2. Robust Actions column (single source of truth)
Collapse to one primary button + overflow menu per row to avoid visual duplication:

```
[ View ▾ ]   ⋯
            ├─ Edit profile        (auto-routes to EditTrainerDrawer if role=trainer, else EditEmployeeDrawer)
            ├─ Manage contract     (opens CreateContractDrawer with role pre-selected; shows count + status if active contract exists)
            ├─ Open profile page   (deep-link to /staff/:id when that route lands; hidden today)
            ├─ ─────────
            ├─ Assign role…        (add/remove Manager/Trainer/Staff record for the same user_id)
            ├─ Reset password      (admin-only; calls auth admin reset)
            ├─ Resend invite       (if user never signed in)
            ├─ ─────────
            ├─ Deactivate          (sets is_active=false on employees + trainers row; confirm AlertDialog)
            └─ Mark exit / offboard (opens lightweight Sheet — exit date, reason, last working day; flips status)
```
Destructive items use `AlertDialog` with the existing Vuexy modal styling. "Edit" and "Contract" stop being two separate row buttons.

### 3. Retire `/employees`
- Delete `src/pages/Employees.tsx`.
- Remove the `/employees` route from `src/App.tsx`.
- Remove `Employees` entries from `src/config/menu.ts` (both blocks).
- In `src/config/navModules.ts`, drop `/employees` from the `hrefs` array.
- In `src/lib/audit/auditMeta.ts`, repoint `employees` and `contracts` deep links to `/hrm?tab=employees&focus=...` and `/hrm?tab=contracts&contract=...`.
- Add a redirect `/employees → /hrm?tab=employees` so old audit links, bookmarks, and the published `theincline.in/employees` URL don't 404.

### 4. Deep-link support
Read `?tab=` and `?focus=` from the URL on HRM mount so audit links land on the right tab and scroll to the right row.

### 5. Keep everything else identical
Contracts tab, Attendance tab, Payroll tab, Policies tab, HR Settings tab — no changes. No DB migration. No edge-function change. No business-logic change.

## Technical details

**Files touched**
- `src/pages/HRM.tsx` — swap Employees tab body, add URL param wiring, add row action menu.
- `src/pages/Employees.tsx` — delete.
- `src/App.tsx` — remove `/employees` route, add `<Navigate to="/hrm?tab=employees" />` for `/employees/*`.
- `src/config/menu.ts` — remove two `Employees` entries.
- `src/config/navModules.ts` — drop `/employees` from hrefs.
- `src/lib/audit/auditMeta.ts` — update two deep-link builders.

**New helpers (small, local to HRM)**
- `useUnifiedStaff()` — extracted from `EmployeesPage`'s query so HRM stops maintaining two parallel staff fetchers (`payrollStaff` becomes a derived view for the Payroll tab only).
- `StaffRowActions` component — owns the dropdown + AlertDialogs.

**Action handlers wire to existing service layer**
- `deactivate` → `supabase.from('employees'/'trainers').update({ is_active: false })` scoped by `user_id`.
- `resetPassword` / `resendInvite` → existing auth admin edge function if available, otherwise hidden behind `can.manageStaff` capability.
- `assignRole` → opens existing `AddEmployeeDrawer` / trainer creation drawer pre-bound to the user_id (no new RPC).

**RBAC**
- Destructive actions gated by `can.manageStaff(roles)` from `src/lib/auth/permissions.ts`.
- Manager sees the same directory but scoped to their branch (already enforced by `BranchContext` + RLS).

## Acceptance criteria

1. `/employees` 301-redirects to `/hrm?tab=employees`; no broken links from audit log or published site.
2. Sidebar shows **HRM only** for owner/admin/manager.
3. HRM › Employees tab matches the richness of the old `/employees` page (5 KPIs, full filter bar, role chips, branch column).
4. Each row has one primary "View" button + one overflow menu; no separate "Contract" + "Edit" duplication.
5. Deactivate, Mark exit, Assign role, Reset password, Resend invite all work and respect RBAC.
6. Dual-role person (e.g. Bhagirath = Manager + Trainer) still appears as a single row with both chips and a single salary.
7. No regression in Contracts, Attendance, Payroll, Policies, HR Settings tabs.