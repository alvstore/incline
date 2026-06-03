## Audit findings

- **Dashboard files**: `src/pages/Dashboard.tsx` (used for Admin + Manager — single file gated by `AppLayout`/roles), `src/pages/StaffDashboard.tsx`. No separate `admin/` or `staff/` subfolders; no `ManagerDashboard.tsx`.
- **DOB column**: Not on `members`. It lives on `public.profiles.date_of_birth` (with `full_name`, `avatar_url`). Members link via `members.user_id → profiles.id`.
- **Existing dashboard hooks**: All data is fetched inline in `Dashboard.tsx` / `StaffDashboard.tsx` with `useQuery`, but with default TanStack settings (no `refetchInterval`, no shared `staleTime`). There is no `useDashboardData.ts` hook yet.
- **Branch scoping**: Admin/Manager uses `useBranchContext().branchFilter`; Staff derives `branchId` from `employees.branch_id`. Birthday RPC must accept an optional branch filter.
- **Design tokens**: Project enforces semantic Tailwind tokens + Vuexy rounded-2xl/shadow-lg cards. "Glassmorphic" widget will be built using existing tokens (`bg-card/60 backdrop-blur-xl ring-1 ring-border/50`) — no raw hex colors.

## Epic 1 — Birthday SQL Engine (migration)

Create RPC `public.get_upcoming_birthdays(p_days_ahead int default 7, p_branch_id uuid default null)`:

- Returns `today` and `upcoming` as two JSON arrays in a single row (one round-trip).
- Year-agnostic match via `to_char(date_of_birth, 'MMDD')` compared against today and the next N days (handles year wrap Dec→Jan).
- Each row: `member_id`, `user_id`, `full_name`, `avatar_url`, `member_code`, `dob` (date), `turning_age` (int), `birthday_date` (next occurrence), `days_until` (0 for today).
- Joins `members m → profiles p on p.id = m.user_id`; filters `m.status='active'`, `p.date_of_birth IS NOT NULL`, optional `m.branch_id = p_branch_id`.
- `SECURITY DEFINER`, `SET search_path = public`, `STABLE`. `GRANT EXECUTE … TO authenticated`.
- Index: `CREATE INDEX IF NOT EXISTS idx_profiles_dob_mmdd ON public.profiles ((to_char(date_of_birth,'MMDD'))) WHERE date_of_birth IS NOT NULL;` for fast lookup.

## Epic 2 — TanStack Query engine upgrade

New file `src/hooks/useDashboardData.ts`:

- Export `DASHBOARD_QUERY_OPTIONS = { refetchOnWindowFocus: true, refetchInterval: 300_000, staleTime: 60_000, refetchIntervalInBackground: false }` — single source of truth.
- Export `useUpcomingBirthdays(branchId?: string | null, daysAhead = 7)` → calls `supabase.rpc('get_upcoming_birthdays', …)`, parses `today` + `upcoming` arrays, returns typed `{ today: BirthdayMember[]; upcoming: BirthdayMember[] }`.
- Export a small helper `useDashboardQuery(key, fn)` that spreads `DASHBOARD_QUERY_OPTIONS` so existing widgets adopt the same cadence without rewriting every block.
- In `Dashboard.tsx` and `StaffDashboard.tsx`: spread `...DASHBOARD_QUERY_OPTIONS` onto the existing `useQuery` calls (stats, revenue, attendance, hourly, receivables, expiring, classes lists). No behavioural rewrites — purely additive options.

## Epic 3 — Birthday Widget UI

`src/components/dashboard/BirthdayWidget.tsx`:

- Glassmorphic card using design tokens: `rounded-2xl bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-xl ring-1 ring-border/50 shadow-lg shadow-primary/5`.
- Header: `Cake` icon in primary-tinted badge, title "Birthdays", subtitle "Today & next 7 days", live dot when `isFetching`.
- **Today section** (only when `today.length > 0`): highlighted block (`bg-primary/10 ring-1 ring-primary/30`), each row shows avatar (with fallback initials), name, "Turning {age}", and a `Send Greeting` button (placeholder `onClick` → `toast.success("Greeting queued")`; wiring to `dispatch-communication` is out of scope for this widget).
- **Upcoming section**: compact list, avatar + name + `{Month Day} · in {n}d` + turning age chip. Caps at 8 rows with a "View all" link to `/members?filter=birthdays-week` (route may not exist; link is non-blocking).
- Empty state: small `Cake` illustration + "No birthdays in the next 7 days".
- Loading state: 1 today-row skeleton + 4 upcoming-row skeletons.
- Accessibility: `aria-label` on Send Greeting buttons including member name, 4.5:1 contrast via semantic tokens, focusable rows.

## Epic 4 — Dashboard injection

- `Dashboard.tsx`: insert `<BirthdayWidget branchId={branchFilter} />` into the existing "Bottom Row" grid (replacing/sharing space with the 2-col Live Access section → change grid to `md:grid-cols-3` with widget taking 1 col, Live Access keeping 2 cols, MembershipDistribution moves up one row). Lazy-load to stay consistent with the existing `LazyLiveAccessLog` pattern.
- `StaffDashboard.tsx`: insert `<BirthdayWidget branchId={branchId} />` near the top of the right column so front-desk sees it without scrolling.
- Apply `...DASHBOARD_QUERY_OPTIONS` to all existing `useQuery` calls in both files (Epic 2 follow-through).
- Verify no new `any` types; widget typed end-to-end.

## Out of scope (explicit)

- Actually sending the birthday greeting (button is a placeholder; can be wired to `dispatchCommunication` in a follow-up).
- New `/members?filter=birthdays-week` route.
- TrainerDashboard / MemberDashboard injection (not requested).

## Files touched

- **New**: `supabase/migrations/<ts>_birthday_rpc.sql`, `src/hooks/useDashboardData.ts`, `src/components/dashboard/BirthdayWidget.tsx`.
- **Edited**: `src/pages/Dashboard.tsx`, `src/pages/StaffDashboard.tsx`.
