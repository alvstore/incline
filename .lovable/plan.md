## Three fixes

### 1. Fix "Could not find a relationship between 'trainers' and 'profiles'" on `/staff-roster`

`useStaffSchedules` uses an auto-generated FK alias (`profiles!trainers_user_id_fkey`) which doesn't exist in the schema cache (and violates our "no auto-gen FK aliases" rule).

**Fix (`src/hooks/useStaffSchedules.ts`):** drop the nested join. Fetch trainers → collect `user_id`s → fetch `profiles` (`id, full_name, avatar_url`) in a second query with `.in('id', userIds)` → merge in JS. Also fetch `staff_shifts` as already done. No schema change.

### 2. Move "Staff Roster" from Training & Bookings → Admin & HR

In `src/config/menu.ts`:
- Admin menu (line 193): remove from "Training & Bookings", insert into "Admin & HR" (after HRM, before Roles and Permission). Roles stay `owner, admin, manager`.
- Manager menu (line 270): same move into Admin & HR section (manager already sees HRM there).

### 3. Late-attendance notifications

**Definition of "late":** trainer/staff clocked in more than **10 minutes after** their scheduled `morning_start` / `evening_start` for today (configurable later; hard-code 10 min grace for now). Triggered the moment they punch in (not via a separate cron).

**Recipients:**
- All managers of the **same branch** as the late staffer.
- All `owner` + `admin` users (cross-branch oversight).

**Implementation (DB-only, no new UI):**

- New migration adds a trigger on `staff_attendance` AFTER INSERT (and AFTER UPDATE of `clock_in`/`check_in`):
  - Look up today's `staff_shifts` row for `NEW.user_id` + current weekday.
  - Pick the scheduled start for the matching `shift_type` (morning → `morning_start`, evening → `evening_start`, night/full_day → whichever is set).
  - If `NEW.clock_in::time > scheduled_start + interval '10 minutes'`, compute `minutes_late` and call:
    - `dispatchCommunication`-equivalent server path is via the existing `notifications` table + `dispatch-communication` edge fn. Simpler: insert internal alerts directly into the existing `notifications` table (which already powers the realtime bell) with `category='staff_late'`, `title='Staff late check-in'`, `body='<Name> clocked in <X> min late at <branch>'`, `user_id` = each recipient.
  - Recipients resolved via:
    - Same-branch managers: `SELECT user_id FROM user_roles ur JOIN employees e ON e.user_id=ur.user_id WHERE ur.role='manager' AND e.branch_id = NEW.branch_id` (fallback to `profiles.branch_id` if employees table doesn't carry branch).
    - Global: `SELECT user_id FROM user_roles WHERE role IN ('owner','admin')`.
  - De-dup using a unique partial index on `notifications (user_id, category, reference_id)` where `reference_id = staff_attendance.id` so a single punch can't double-notify.

- Trigger function is `SECURITY DEFINER`, `SET search_path = public`.

**Channels:** in-app only for v1 (writes to `notifications`, surfaces in the bell). WhatsApp/email can be layered later by routing the same event through `dispatch-communication` — out of scope for this pass to avoid template approvals.

### Files touched
- `src/hooks/useStaffSchedules.ts` (rewrite the fetch)
- `src/config/menu.ts` (move two menu entries)
- New migration: trigger + helper function + de-dup index on `notifications`

### Out of scope
- Configurable grace-minutes UI (hard-coded 10).
- WhatsApp/SMS/email channels for the late alert.
- Early-leave or no-show alerts (separate pass).