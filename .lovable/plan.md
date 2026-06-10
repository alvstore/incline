## Goal

1. Confirm branch managers can manage HR/Payroll for their branch's staff (employees, contracts, trainers, payroll) — but **never themselves**.
2. Owner/Admin retain full cross-branch access.
3. Drop the unused `role_permissions` and `permissions` tables; `role_capabilities` + `has_role()` remain the SSOT.
4. Re-run security scan and update memory.

## Current state (audited)

| Table | Manager access today | Self-edit blocked? |
|---|---|---|
| `employees` | ALL on `branch_id IN user_visible_branch_ids` | NO |
| `contracts` | ALL same scope | NO |
| `trainers` | ALL same scope | NO |
| `hr_settings` | SELECT only (admin manages) | n/a (org-level) |
| `payroll_runs` / `payroll_run_lines` | ALL (not branch-scoped) | NO |
| `payroll_items` | ALL via `run.branch_id` scope | NO |
| `payroll_rules` | admin/owner only | n/a |
| `profiles` | SELECT for branch members | NO |

Gaps: (a) manager can edit/payroll themselves; (b) `payroll_runs`/`payroll_run_lines` not branch-scoped for manager; (c) two dead tables.

## Plan

### Step 1 — Self-edit guard (DB triggers, mirrors `src/lib/auth/permissions.ts`)

Add `tg_block_manager_self_hr` BEFORE INSERT/UPDATE/DELETE on `employees`, `contracts`, `trainers`, `payroll_items`, `payroll_run_lines`:

```
IF current actor has 'manager' role
   AND NOT has_any_role(actor, ['owner','admin'])
   AND row.user_id = auth.uid()
THEN RAISE EXCEPTION 'Managers cannot modify their own HR/payroll record'
```

(Owners/admins exempt; self-row READ still allowed via existing `*_self_select` policies.)

### Step 2 — Tighten `payroll_runs` / `payroll_run_lines` to manager's branch

Replace the broad `payroll_runs_admin_all` and `payroll_run_lines_admin_all` policies with:
- Owner/Admin: full access.
- Manager: `branch_id IN user_visible_branch_ids(auth.uid())` (for `payroll_run_lines`, join through `payroll_runs`).

### Step 3 — Mirror self-block in client permission registry

In `src/lib/auth/permissions.ts` add `canManageOwnHR = false` for manager, and a `canManageEmployeeRow(actorRoles, targetUserId, currentUserId)` helper analogous to `canEditRosterRow`. UI components that render edit/payroll buttons (`Employees.tsx`, `Trainers.tsx`, payroll runs UI) call the helper to hide actions on the manager's own row. Server trigger from Step 1 is the actual enforcement.

### Step 4 — Drop dead tables

```
DROP TABLE IF EXISTS public.role_permissions;
DROP TABLE IF EXISTS public.permissions;
```

Both have 0 rows and 0 code references (confirmed by ripgrep). `role_capabilities` + `has_role()` + `has_capability()` remain the SSOT.

### Step 5 — Verify & document

- Re-run `security--run_security_scan` and `supabase--linter`.
- Manual checks (psql with `SET role authenticated; SET request.jwt.claim.sub = '<manager-uuid>'`):
  - Manager UPDATE on own `employees` row → must raise exception.
  - Manager UPDATE on staff row in their branch → succeeds.
  - Manager UPDATE on row in other branch → blocked by RLS.
  - Manager SELECT on `payroll_runs` of foreign branch → 0 rows.
- Update `mem://architecture/p4-app-layer-hardening` with the self-edit rule and removal of the dead permission tables.
- Update **Security Memory** to note: managers have branch-scoped HR/Payroll but cannot modify their own row; `role_permissions`/`permissions` are gone.

## Out of scope

- The earlier-discussed column-level revocation on salary/PAN for managers. User has confirmed managers need HR data to do their job — keeping row-level access. Sensitive columns remain accessible to manager within their branch.
- Refactoring the role model itself.
- Realtime channel scoping (separate finding).

## Files / migrations

1. `supabase/migrations/<ts>_hr_self_edit_guard.sql` — triggers (Step 1) + payroll scope tightening (Step 2) + DROP TABLE (Step 4).
2. `src/lib/auth/permissions.ts` — helper + export.
3. `src/pages/Employees.tsx`, `src/pages/Trainers.tsx`, payroll list UI — hide edit on own row.
4. Security memory update via tool.

Approve to implement.
