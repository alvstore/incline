# Member Portal: Attendance History, Booking Flash Fix, Recovery Add-ons

## 1. My Attendance — full history, not just this month

Today the page only queries the current month and shows a fixed month grid, so there is no way to look at a quarter, a year, or the whole membership.

Redesign (`/my-attendance`):
- **Range switcher** at the top: Month · Quarter · Year · All time, plus prev/next arrows for the selected period and a period label ("August 2026", "Q3 2026", "2026").
- **Gradient hero** matching the Workout/Diet plan pages: period label, total visits, days visited, current streak, best streak.
- **Stat strip**: total visits, unique days, average duration, consistency % (computed against elapsed days of the selected period, not the whole month).
- **Contribution heatmap**: month view = day grid; quarter/year view = compact week-column heatmap with intensity by visits, tooltips per day.
- **Trend bar chart**: visits per day (month) or per month (quarter/year).
- **Visit log**: paginated list of check-in/check-out rows with duration badges and an empty state; "currently checked in" card and Check Out button retained.
- Loading skeletons, error fallback, empty state; all Vuexy tokens (`rounded-2xl`, soft shadows, colored status badges).

Data: same `member_attendance` table, query range derived from the selected period; no backend change.

## 2. `/book` flashes "select your gender"

Root cause confirmed: the gender banner renders from `!profile?.gender`, and the `my-profile-gender` query is still loading on first paint, so `profile` is `undefined` and the warning shows for a moment before data arrives.

Fix: only evaluate the banner after the profile query has resolved (`isFetched`/not loading) and the member genuinely has no gender set. Recovery slots keep their existing gender filter but wait for the same resolution so the list does not flicker either.

## 3. Store banner → Recovery & Add-ons showcase

Replace the generic "Need extra sessions or PT?" strip on `/store` with a real add-ons section driven by the branch's active `benefit_packages` and `pt_packages`:

- **Cards per available add-on** (Sauna, Ice Bath, Steam, 3D Body Scan, PT), each with icon, sessions/quantity, validity, price.
- **Action logic per card**:
  - Member already has active credits for that benefit type → primary **Book** button deep-linking to `/book?type=recovery`, with a "N credits left" badge.
  - No credits but the package is sellable at the branch → **Buy add-on** opening the existing `PurchaseAddOnDrawer` on the right tab.
  - Nothing active/sellable for that type → the card is not rendered.
- **Fallback**: if the branch has no active benefit or PT packages at all, show only a slim informational banner (no dead "Buy add-ons" button).
- Section sits above the product grid, visually separated from products so add-ons never look like store SKUs.

## Technical notes

- Files touched: `src/pages/MyAttendance.tsx` (rewrite into `src/components/member/attendance/` parts: `AttendanceHero`, `RangeSwitcher`, `AttendanceHeatmap`, `AttendanceTrend`, `VisitLog`), `src/pages/MemberClassBooking.tsx` (gender gating), `src/pages/MemberStore.tsx` + new `src/components/member/store/AddOnShowcase.tsx`.
- Reuses `PurchaseAddOnDrawer` and `member_benefit_credits` for credit counts; TanStack Query throughout with descriptive keys and `branch_id` scoping.
- No database migrations, no RLS changes, no business-logic changes.
