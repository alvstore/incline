## Sunday Duty — date scope + recurring / one-off toggle

### Goal
Today's "Assign Sunday Duty" sheet writes recurring `staff_shifts` rows for weekday=0 but the UI says "this Sunday" with no date. Fix the ambiguity: the sheet shows the **target Sunday date**, lets the user pick which Sunday, and toggle between **recurring** (every Sunday) and **just this Sunday** (one-off override).

### Database (new table)

`staff_shift_overrides` — per-date override of a staff member's recurring weekday shift. One-off rules win over `staff_shifts` for that exact date.

Columns:
- `id uuid pk default gen_random_uuid()`
- `user_id uuid not null`
- `branch_id uuid not null`
- `date date not null` (the specific Sunday — or any date in future, not Sunday-only)
- `morning_start time null`, `morning_end time null`
- `evening_start time null`, `evening_end time null`
- `is_weekly_off boolean not null default false` (lets us also use this to one-off-revoke a Sunday duty)
- `note text null`
- `created_by uuid null`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`
- Unique `(user_id, date)` so an upsert replaces.

RLS: same scope as `staff_shifts` — branch-scoped read for staff/manager/owner; insert/update restricted to roles with `staff.manage` capability (mirrors existing `staff_shifts` policies). Indexes: `(branch_id, date)`, `(user_id, date)`.

### Frontend — `SundayAssignSheet` (`src/pages/StaffRoster.tsx`)

Add at the top of the sheet body, above the search box:

1. **Sunday picker row** (sticky inside the sheet):
   - Left: `‹` button → previous Sunday.
   - Center: shadcn `Popover` + `Calendar` (mode=single, `disabled={d => d.getDay() !== 0 || d < startOfToday}`) showing `"Sun, 02 Jun 2026"`. Default = next upcoming Sunday (today if today is Sun, else next Sun).
   - Right: `›` button → next Sunday.
   - Subline: `"Effective on this date"` or `"Repeats every Sunday from this date"` depending on the toggle below.

2. **Scope toggle** (segmented control, `Tabs` or two-button group):
   - **Just this Sunday** (default) — writes to `staff_shift_overrides`.
   - **Every Sunday going forward** — writes to `staff_shifts` (current behavior).
   - Tooltip explains the difference.

3. **Already-assigned hint**: when the sheet opens with a date selected, prefetch existing overrides + recurring shifts for that Sunday and pre-check those staff with their saved times, so the user sees the current state and can edit instead of duplicating.

4. **Sheet description** rewrites to: `"Assigning Sunday duty for Sun, 02 Jun 2026. Toggle whether it applies just to this Sunday or to every Sunday going forward."`

### Save logic (`onAssign` in `StaffRoster.tsx`)

```text
if scope === 'recurring':
  upsert staff_shifts (user_id, weekday=0, times…, is_weekly_off=false)
else:  // one-off
  upsert staff_shift_overrides (user_id, date=selectedSunday, times…, is_weekly_off=false)
```

Toast: `"Sunday duty assigned to N staff for 02 Jun"` or `"…for every Sunday going forward"`.

### Read path — overrides win

Update `useStaffSchedules` (and any day/week renderer that resolves a Sunday cell) to fetch overrides for the visible date range and use the override row when one exists for `(user_id, date)`; fall back to the recurring `staff_shifts` row otherwise. Day view (already pinned to a real date) and Week view (real Mon–Sun dates) both honor overrides; Month matrix continues to show the recurring pattern but flags dates with overrides via a subtle dot.

### `SundayDutyCard` updates

- Header: show the selected/next Sunday date next to the title.
- Body lists staff working that specific Sunday (overrides merged onto recurring).
- Each row shows a small badge: `One-off` (amber) or `Recurring` (slate) so managers can tell at a glance.

### Files touched

- New: `supabase/migrations/<ts>_staff_shift_overrides.sql`
- `src/hooks/useStaffSchedules.ts` — fetch + merge overrides; expose `useUpsertShiftOverride` mutation.
- `src/pages/StaffRoster.tsx` — `SundayAssignSheet` (date picker + scope toggle + prefill), `SundayDutyCard` (date header + badge), day/week resolvers.

### Out of scope

- Generalizing overrides to non-Sunday days (table supports it; UI stays Sunday-only for now).
- Editing/removing an existing override from the card — handled in a follow-up; for now re-opening the sheet on the same Sunday and unchecking a person + saving will be the path (add a "Remove from this Sunday" action in v2).
