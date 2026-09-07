# Exclude owners/admins from staff ops, fix gate list names & duplicate people

Four separate issues, all confirmed against live data.

## 1. Owners and admins keep appearing in payroll, roster and HR

Confirmed: Rajat Lekhari (owner+admin) and Yogita Lekhari (admin) both have active
employee records (EMP-INC-0003, EMP-INC-0004), so every staff surface picks them up.

Fix: treat "owner/admin" as excluded everywhere staff are managed.

- Payroll run creation skips anyone holding an owner or admin role, so no payslip
  line is ever created for them.
- Staff Roster (day/week/month/attendance views) hides them, and the role/department
  chips and counts recalculate without them.
- HRM staff lists (employees tab, HR settings pickers, payroll participant lists)
  hide them too.
- They keep full access to *view* and manage everyone else — only their own
  employment/payroll rows disappear from these screens.

## 2. Same person listed twice with two roles

Confirmed: Bhagirath Gurjar has one login but two records — `employees.EMP-MOZWZUNA`
and `trainers.TR-INC-00001`. He therefore shows as both "Staff" and "Trainer".

Fix: merge by person, not by record. Anywhere a staff list is built (HRM, roster,
devices personnel sync, payroll), one row per person with a single primary role
(trainer wins when both exist) and the secondary role shown as a small extra badge.
Payroll already keys on the person, but the run builder will be de-duplicated to
one entry per user so the source record can't change the outcome.

No records are deleted — this is a display/selection change.

## 3. Gate list shows codes instead of names

Confirmed: `mips_device_face_state.person_name` holds the code (e.g. `INC-26-0140`),
not the person's name, because that is what the gate server stores as the person name.

Fix:
- The Face-truth panel resolves real names from members/employees/trainers by code
  and shows `Name` as the headline with `code · type · attempts` underneath.
- The background parity job also writes the CRM full name into the ledger going
  forward, and a one-off backfill fills in existing rows, so the names survive
  outside this screen too.

## 4. "Gate 1 — 15 behind" is not understandable

Today the card shows three bare numbers (faces on gate / people on gate / should
carry) plus a `15 behind` badge with no explanation of what is wrong or what to do.

Redesign of the gate card:
- One plain headline: "Gate 1 is missing 15 face photos" (or "Gate 1 is fully in
  sync") instead of the cryptic badge.
- A progress bar: 137 of 152 photos delivered.
- The three counters stay, but each gets a one-line plain description
  ("photos stored on this gate", "people known to this gate", "photos the server
  holds — the target").
- Status chips keep names/counts but read as sentences: "149 people confirmed on
  this gate", "28 waiting to be sent".
- The waiting list rows show name first, code second, and a single clear status.

## Technical notes

- `payroll_create_run`: add `NOT EXISTS (select 1 from user_roles where role in
  ('owner','admin'))` to the union, and `SELECT DISTINCT ON (user_id)` so one row
  per person (trainer kind preferred).
- `useStaffSchedules`, `useUnifiedStaff`: fetch `user_roles` for the fetched ids and
  drop owner/admin; keep the existing merge-by-`user_id` behaviour and expose a
  single `primaryRole` plus `roles[]`.
- `src/pages/HRM.tsx`, `HrSettingsTab.tsx`, `PayrollRunPanel.tsx`, `StaffRoster.tsx`:
  consume the filtered lists; no local role logic duplication.
- `src/components/devices/FaceEnrolmentPanel.tsx`: new name-resolution query
  (members.member_code / employees.employee_code / trainers.trainer_code →
  profiles.full_name), plus the card redesign above.
- `supabase/functions/_shared/mipsFaceState.ts` + `mips-face-parity`: persist the CRM
  name in `person_name`; one migration to backfill existing rows.
- Personnel sync tab in `/devices`: de-duplicate by `user_id` the same way.

## Out of scope

No changes to gate hardware sync logic, attendance capture, or payroll maths.
