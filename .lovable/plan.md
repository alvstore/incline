
## Scope

Two related changes:

1. **Permission matrix for StaffRoster** (view / edit / export of shifts, Sunday duty, overrides).
2. **Trainer & Staff dashboards** show *their own* shift times for today + the week, with a **Late** badge per day when check-in is after the scheduled start.

No schema changes — `staff_shifts`, `staff_shift_overrides`, and `staff_attendance` already cover everything.

---

## 1. Permission matrix

Source of truth: `roles` from `useAuth()` evaluated against the row being edited (`employee.user_id` / `trainer.user_id`).

| Role | View roster | Export / Print / Send | Edit any row (shift, override, Sunday) | Edit own row |
|---|---|---|---|---|
| Owner / Admin | yes | yes | yes | yes |
| Manager (own branch) | yes | yes | yes (staff + trainer) | **no** |
| Staff | yes (own branch) | yes | no | no |
| Trainer | (out of scope — no roster page) | — | — | — |

Helper added inline in `StaffRoster.tsx` (or `src/lib/auth/permissions.ts` as `canEditRosterRow`):

```ts
canEditRosterRow(roles, targetUserId, currentUserId):
  if owner|admin → true
  if manager → targetUserId !== currentUserId
  else → false

canExportRoster(roles): any of owner|admin|manager|staff
canEditAnyRoster(roles): owner|admin|manager
```

UI gating in `StaffRoster.tsx`:

- "Assign Sunday Duty", "Add Shift", per-row edit/delete, save buttons in `SundayAssignSheet` and shift sheets → hidden/disabled via `canEditAnyRoster` and per-row `canEditRosterRow`.
- In the Sunday sheet checklist, the manager's **own row** renders read-only (badge: *"You — ask another manager or owner to edit"*).
- Export / Print / Send buttons remain visible for staff and managers.
- Read-only mode shows the same layout but inputs become `disabled`, action buttons return `null`, and pointer cursors drop.

Defense-in-depth on the server: the existing RLS on `staff_shifts` / `staff_shift_overrides` already restricts to owner/admin/manager. Add a Postgres trigger `tg_block_manager_self_edit` on both tables — reject `INSERT/UPDATE/DELETE` when `auth.uid() = NEW.user_id` AND caller has *only* `manager` (not owner/admin). Uses existing `has_role` helper, no recursion risk.

## 2. Own-shift visibility + Late badge

### Shared hook — `src/hooks/useMyShiftWeek.ts`

Returns, for a `userId` and date range (default = current week, Mon–Sun):

```ts
{ date, weekday, morning_start/end, evening_start/end, is_off,
  source: 'override' | 'recurring' | 'none',
  attendance: { first_check_in, late_minutes, is_late } | null }
```

- Reads `staff_shift_overrides` for the range first, then falls back per-date to `staff_shifts` by weekday (same merge logic as Sunday card).
- Joins `staff_attendance` rows for the user in the date range, takes the earliest `check_in` per local date.
- **Late rule:** `is_late = first_check_in > scheduled_start + 10 min grace` (configurable constant `LATE_GRACE_MIN = 10`). Compute against `morning_start` when present, otherwise `evening_start`.

### TrainerDashboard.tsx

Augment the existing "My Shift" card:
- Show today's AM/PM windows (already present) + a small `Late` chip next to today if `is_late`.
- New **"This week"** strip: 7 day pills (Mon–Sun) each showing `06:00 AM – 12:00 PM` (12-h format via existing `fmtTime12`) and a `Late` badge for days with `is_late`. Off days show "Weekly off".

### StaffDashboard.tsx

Add the same **"My shift & attendance"** card (currently missing). Same data, same Late badge. Placed above the existing "Today's check-ins" card.

### Badge style

`bg-red-100 text-red-700 rounded-full px-2 py-0.5 text-xs font-medium` with `Clock` icon (lucide). Tooltip: `Checked in at 06:18 AM (18 min late)`.

---

## Files touched

- `src/pages/StaffRoster.tsx` — gate buttons + sheet inputs by `canEditRosterRow` / `canEditAnyRoster`; show "You" read-only chip for manager self-row.
- `src/lib/auth/permissions.ts` — add `canEditRosterRow`, `canEditAnyRoster`, `canExportRoster` helpers.
- `src/hooks/useMyShiftWeek.ts` — **new** shared hook (overrides ∪ recurring + attendance merge, late computation).
- `src/pages/TrainerDashboard.tsx` — wire weekly strip + Late badge.
- `src/pages/StaffDashboard.tsx` — add "My shift & attendance" card.
- **Migration**: trigger `tg_block_manager_self_edit` on `staff_shifts` and `staff_shift_overrides` (manager-only self-edit guard).

## Out of scope

- Changing the late grace per branch (hard-coded 10 min for now).
- Adding shift visibility for members or owners' own card.
- Editing the Late threshold from settings UI.
