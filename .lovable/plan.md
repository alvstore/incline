
## Scope
Frontend-only refinements to `src/pages/StaffRoster.tsx` and `src/hooks/useStaffSchedules.ts`. No DB schema, no business-logic changes.

---

## 1. Dynamic role + department filters (replace hardcoded chips)

**Problem:** The chipbar `All · Trainer · Manager · Front Desk · Cleaning · Staff` is a fixed literal — branches that hire a "Sales Rep" or "Maintenance Staff" never appear as their own chip, and 0-count chips clutter the UI.

**Fix in `useStaffSchedules.ts`:**
- Extend `TrainerRosterRow` with `department: string | null` (already fetched, just expose it).
- Keep `role` as the broad bucket (Trainer / Manager / Front Desk / Cleaning / Staff) — this stays the *primary* filter axis because it drives RBAC tone and matrix colour.
- Add `position` (already there) so the UI can show the real job title under the name.

**Fix in `StaffRoster.tsx`:**
- Build `roleChips` from the live data: `Array.from(new Set(allStaff.map(s => s.role)))`, sorted by count desc. Drop any chip with 0 — the "All" chip stays pinned first.
- Add a second chip row "Department" rendered the same way, sourced from `Array.from(new Set(allStaff.map(s => s.department).filter(Boolean)))`. Selecting a department narrows within the active role.
- State becomes `{ role: RoleFilter; department: string | null }`. Reset department to null when role changes.
- Show each chip with its dynamic count, e.g. `Training · 3`. Use Vuexy chip styling already in place.
- In Day / Week / Month rows, render the real `position` as a muted subline under the name (e.g. "Personal Trainer", "Branch Manager") so the role chip and the actual job title both surface.

**Empty-state copy:** "No staff in this branch yet — add from HRM or Trainers." (replaces current "change the role filter" hint when the underlying list is empty, not just filtered).

---

## 2. Sunday Duty assignment UI

**Problem:** Sunday handling today is buried inside the Edit drawer (the amber hint). Managers need an at-a-glance "who's on Sunday" view and a one-click way to add someone.

**Add a new collapsible card above the main grid, visible on all views:**

```text
┌─ Sunday Duty · 25 May ──────────────────── [+ Assign Sunday] ┐
│  Avatars of staff with a non-weekly-off Sunday shift,         │
│  each with their AM/PM pill. Empty state: "No one assigned    │
│  for Sunday — tap Assign Sunday."                             │
└───────────────────────────────────────────────────────────────┘
```

- Source: `allStaff.filter(s => s.shifts[0] && !s.shifts[0].is_weekly_off)`.
- Each pill is clickable → opens existing `ShiftEditSheet` with `weekday=0` pre-selected so timings can be tweaked.
- **`+ Assign Sunday` button** opens a new compact sheet `SundayAssignSheet`:
  - Searchable list of staff who currently have Sunday as weekly-off OR no Sunday row.
  - Per-row time inputs (default 06:00–12:00, editable, AM/PM display).
  - Confirm writes via existing `useUpsertShift` for each selected staff (loops `mutateAsync`). The row's existing `is_weekly_off=true` row gets overwritten to a working shift — the contractual override the user described.
  - Toast: "Sunday duty assigned to N staff."
- Keep the inline amber hint inside `ShiftEditSheet` for the case when a manager edits Sunday directly — it complements the new card.

**Why a card, not a separate tab:** Sunday duty is exceptional, not a recurring rhythm. Surfacing it persistently next to the day/week/month grid matches the "data-dense premium SaaS" tone without inventing new navigation.

---

## Files touched
- `src/hooks/useStaffSchedules.ts` — expose `department`, keep types backward-compatible.
- `src/pages/StaffRoster.tsx` — dynamic chips, dual-axis filter (role × department), position subline, new `SundayDutyCard` + `SundayAssignSheet`.

## Out of scope
- No changes to PDF export, attendance matrix, employee creation forms, or the DB.
- No new RPCs — reuses `useUpsertShift` already wired.

**Skills applied:** ui-ux-pro-max (chip density + Sunday card pattern), senior-frontend (state shape, dynamic chip derivation).
