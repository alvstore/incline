# Split-Shift Roster & Duty Punch-In

Extend the existing `staff_shifts` and `staff_attendance` tables to support split shifts (morning + evening blocks, including overnight). Build an admin roster page and a trainer duty-status widget. No new tables.

## Epic 1 — Schema (migration)

**`staff_shifts` additions** (per user+weekday row stays unique):
- `morning_start time NULL`, `morning_end time NULL`
- `evening_start time NULL`, `evening_end time NULL`
- Make existing `start_time` / `end_time` **NULL-able** (back-compat: legacy single-shift rows stay valid; new rows use morning_/evening_ pairs)
- CHECK: at least one block must be populated when `is_weekly_off = false`; each populated block must have both start+end
- Overnight is represented by `morning_end < morning_start` (e.g. Kunal: morning 21:00→06:00, evening NULL) — no extra column needed

**`staff_attendance` additions:**
- `shift_type text` with CHECK in `('morning','evening','night','full_day')`, default `'full_day'` for legacy rows
- `total_hours numeric(5,2)` — auto-populated on `check_out` via trigger
- Drop the second redundant unique index `staff_attendance_one_open_uidx` (duplicate of `staff_attendance_one_active_per_user`) **only if safe** — otherwise leave. Replace single-open-per-user constraint with `(user_id, shift_type) WHERE check_out IS NULL` so a trainer can have morning closed + evening open same day.

**RPC `calculate_shift_hours(p_clock_in timestamptz, p_clock_out timestamptz) returns numeric`:**
- `STABLE`, `SECURITY INVOKER`, `SET search_path = public`
- Returns `EXTRACT(EPOCH FROM (p_clock_out - p_clock_in)) / 3600.0` rounded to 2 decimals; tstz subtraction natively handles midnight crossover, so no manual day-add needed
- Returns NULL if either arg is NULL

**Trigger `tg_staff_attendance_total_hours`** BEFORE UPDATE: when `check_out` transitions from NULL→value, set `NEW.total_hours = calculate_shift_hours(NEW.check_in, NEW.check_out)`.

**RPC `punch_duty(p_shift_type text)`** — atomic clock-in/out:
- Resolves `auth.uid()`, finds open row for `(user_id, shift_type)`. If none → INSERT (check_in = now, branch from active branch / user's primary). If open exists → UPDATE check_out = now (trigger fills total_hours). Returns the row.
- `SECURITY DEFINER`, `SET search_path = public`, grants to `authenticated`.

RLS: existing policies on both tables already cover the new columns. No new policies needed.

## Epic 2 — Admin Roster page

**Route:** add `/admin/staff-roster` to `src/App.tsx` (admin/owner/manager only via `can.manageStaff`). New file `src/pages/StaffRoster.tsx` (the brief says "no new files unless required" — a new route page is required).

**Data hook** `src/hooks/useStaffSchedules.ts`: TanStack Query keyed `['staff-schedules', branchId]`. Joins `staff_shifts` with trainer profiles (filtered to role = trainer). Returns one row per trainer with 7 weekday cells.

**UI (Vuexy):**
- Header: title, branch indicator, "Add Trainer to Roster" sheet trigger, weekday tabs (Mon-Sun, default = today)
- `rounded-2xl bg-white shadow-lg shadow-slate-200/50` card holding a sticky-header table:
  - Columns: Trainer (avatar + name) · Morning Shift · Evening Shift · Weekly Off · Actions
  - Each shift cell shows pill `06:00 → 10:00` (emerald for morning, indigo for evening, blue for overnight when end<start) or muted "—"
  - Row hover → reveal pencil/trash actions
- Edit drawer (right-side `Sheet`, `sm:max-w-xl`): weekday selector, two grouped sections "Morning Block" / "Evening Block" each with a pair of shadcn time inputs and a "Clear block" button. Weekly-off toggle disables both. Zod validation: each populated block requires both ends; overnight allowed; not both blocks empty unless weekly-off.
- Loading: skeleton table rows. Empty: illustration + "Add first trainer". Error: standard error card.

## Epic 3 — Trainer Dashboard Duty widget

**Edit** `src/pages/TrainerDashboard.tsx` only. Add `<DutyStatusCard />` component **inline in the same file** (per "don't introduce new files" — only inline component) at the top of the dashboard.

Behavior:
- Query today's `staff_shifts` row for `auth.uid()` + `weekday = today`
- Query today's `staff_attendance` rows for same user (date = today, IST)
- Determine "current block" via time proximity:
  - If `now` is within ±2h of morning block → suggest `morning`
  - Else if within ±2h of evening block → suggest `evening`
  - Else if morning is overnight (end<start) and now ∈ overnight window → `night`
  - Fallback → `full_day`
- Card shows:
  - Scheduled today: two pills (Morning / Evening) with times or "Off"
  - Live timer if any open row exists ("Clocked in 2h 14m ago — Morning shift")
  - Big CTA: `Clock In · Morning Shift` (indigo gradient) or `Clock Out` (red) — calls `punch_duty(shift_type)` via `useMutation`, then invalidates `['my-attendance']`
  - If both blocks already closed: muted "Duty complete for today"
- Skeleton + error states.

## Files

**New:**
- `src/pages/StaffRoster.tsx`
- `src/hooks/useStaffSchedules.ts`
- Migration file (Supabase)

**Edited:**
- `src/App.tsx` (route)
- `src/config/menu.ts` or sidebar nav (link under Staff section)
- `src/pages/TrainerDashboard.tsx` (inline DutyStatusCard + punch hook)

## Technical notes

- All times stored as `time` in IST-naive form (matches existing `staff_shifts`)
- "Date" in attendance derived from `check_in AT TIME ZONE 'Asia/Kolkata'` for grouping
- MIPS webhook later: `mips-webhook-receiver` will INSERT into `staff_attendance` with `shift_type` inferred from same proximity rule — schema is forward-compatible, no future migration needed
- Skills applied: ui-ux-pro-max (Vuexy density/pattern), senior-backend (atomic RPC + trigger), senior-architect (extend-don't-duplicate decision), supabase-postgres-best-practices (partial unique index, STABLE/DEFINER hygiene)

## Out of scope

- MIPS webhook wiring (deferred to July prep)
- Overtime/payroll calculations
- Multi-week roster templates / bulk copy
- Mobile-app native check-in