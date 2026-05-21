## Audit findings (employee / staff / trainer offboarding)

### What exists today
- **`StaffRowActions` "Deactivate"** only flips `employees.is_active` / `trainers.is_active`. It does NOT:
  - Revoke MIPS turnstile access (door still opens with their face/card)
  - Remove `user_roles` rows (they can still sign into the app with manager/staff/trainer privileges)
  - Record why/when they left
  - Sign them out of active sessions
- **`mips-access` edge function** handles `revoke / restore / sweep_expired` but is **member-only** — it reads from `members`, updates `members.hardware_access_status`, and never touches employees/trainers.
- **`sync-to-mips` edge function** already knows how to push `employee` and `trainer` to MIPS (`person_type === "employee" | "trainer"`, deptId 101). It sets `validTimeEnd = PERMANENT_END` on add. There is **no path** that updates an existing MIPS person with a past `validTimeEnd` (which is how MIPS RuoYi revokes access without deleting biometrics).
- **DB schema gap:** `employees` and `trainers` have no `exit_date`, `exit_reason`, `exit_type`, or `terminated_by` columns — so we can't audit who left, why, or when.
- **Auth gap:** no flow removes `user_roles` for the departing person, and no flow disables/locks their `auth.users` account.
- **No UI** for "Mark exit / Offboard" — only the soft Deactivate toggle.

### Plan

#### 1. DB migration
- Add to `employees` and `trainers`:
  - `exit_date date`, `exit_reason text`, `exit_type text` (resigned | terminated | end_of_contract | absconded | other), `exit_notes text`, `exited_by uuid` (FK profiles.id)
- Index `(branch_id, is_active, exit_date)` for roster queries.
- Validation trigger (not CHECK): `exit_date IS NULL` ⇔ `is_active = true`.

#### 2. Extend `mips-access` edge function (single source of truth)
- Accept new body shapes:
  - `{ action: "revoke_staff" | "restore_staff", person_type: "employee" | "trainer", person_id, reason? }`
- For staff: load row → resolve `mips_person_sn` → call MIPS `updatePerson` with `validTimeEnd = "2000-01-01 00:00:00"` (past date) to revoke, or `PERMANENT_END` to restore. Dispatch to all branch devices via existing helper.
- Update `employees/trainers.mips_sync_status` to `revoked` / `active`.
- Log to `audit_logs` with action `staff_access_revoked` / `staff_access_restored`.
- Version bump (e.g., v2.0.0) + CORS preserved.

#### 3. New `offboard-staff` edge function (orchestrator)
Single atomic call that runs the full offboarding pipeline server-side (so it can't half-fail from the client):
1. RBAC: only `owner` / `admin` / `hr_manager` via `has_capability`.
2. `mips-access` invoke → revoke turnstile (best-effort, log failure but continue).
3. Update `employees`/`trainers`: `is_active=false`, `exit_date`, `exit_reason`, `exit_type`, `exit_notes`, `exited_by`.
4. Delete matching `user_roles` rows for the person's `user_id` for the role(s) being offboarded (preserve `member` role if they're also a member).
5. If no remaining roles AND not a member → call `auth.admin.updateUserById(user_id, { ban_duration: 'none', user_metadata: { offboarded_at } })` and revoke refresh tokens (`auth.admin.signOut(user_id, 'global')`).
6. Cancel future shifts/classes (best-effort: mark `class_schedules.trainer_id = null` for future dates if trainer).
7. Insert `audit_logs` row `staff_offboarded` with full payload.
8. Return per-step status so UI shows what succeeded.

#### 4. New `restore-staff` edge function (mirror)
Reactivates `is_active=true`, clears `exit_*`, reinstates `user_roles` (from a snapshot stored in audit log), calls `mips-access` restore, optionally unbans auth user.

#### 5. Frontend — `StaffRowActions` overhaul
Replace single "Deactivate" with two distinct overflow items:

- **Soft Deactivate** (existing behavior) — keep for "temporary pause, still on payroll".
- **Offboard / Mark exit…** — opens new `OffboardStaffSheet` (right-side Sheet per project rule):
  - Role pickers (if multi-role): which roles to offboard
  - Exit type (select), Exit date (default today), Reason, Notes
  - Checklist preview (auto-checked, read-only): Revoke turnstile · Remove app access · Cancel future shifts · Keep payroll history
  - Sticky footer: Cancel · "Offboard <Name>" (destructive)
  - Confirm via `AlertDialog` ("Type the employee's name to confirm")
  - On submit → `supabase.functions.invoke('offboard-staff', …)` → toast with per-step result chips → invalidate `UNIFIED_STAFF_KEY`, `hrm-employees`, `hrm-payroll-staff`, `trainers`.

For already-offboarded rows: show **"Reinstate…"** which calls `restore-staff`.

#### 6. HRM page additions
- New filter chip: **Status = Active | Deactivated | Offboarded** (today there's only Active/Inactive).
- In the row: when `exit_date` set, show a small `Offboarded · DD MMM` badge next to the name and dim avatar opacity-60.
- KPI tile "Active" already exists; add small subtitle "X offboarded this month" computed from `exit_date`.

#### 7. Vuexy polish on the new Sheet
- Rounded-2xl, soft shadow, no border (project rule)
- Indigo primary + red destructive button
- lucide icons: `UserX`, `ShieldOff`, `KeyRound`, `CalendarX`
- Skeleton + error states; submit disables button + spinner
- All field labels associated, destructive action requires typed name (a11y)

#### 8. Acceptance criteria
- Clicking "Offboard" on a manager:
  - MIPS device denies their card/face within 1 sync cycle
  - They can no longer sign into `/auth` (session revoked)
  - Row shows `Offboarded · 21 May` and falls out of "Active" KPI
  - `audit_logs` has one `staff_offboarded` row with the full snapshot
- Trainer-only person: same, plus future class slots show "Trainer removed"
- Dual-role (Manager + Trainer): UI lets HR pick whether to offboard one role or all
- Reinstate restores roles from the audit snapshot, calls MIPS restore, sets `is_active=true`

### Files touched
- **New:** `supabase/functions/offboard-staff/index.ts`, `supabase/functions/restore-staff/index.ts`, `supabase/migrations/<ts>_staff_offboarding.sql`, `src/components/hrm/OffboardStaffSheet.tsx`
- **Edited:** `supabase/functions/mips-access/index.ts` (+ staff branches), `src/components/hrm/StaffRowActions.tsx`, `src/hooks/useUnifiedStaff.ts` (surface `exit_date`/`exit_type`), `src/pages/HRM.tsx` (filter + KPI subtitle)

### Out of scope (call out, don't build now)
- Bulk offboarding (multi-select)
- Exit interview form / document upload
- Final-settlement payroll calculation (separate ticket — touches payroll engine)

Used the senior-architect / senior-backend / senior-frontend skills.