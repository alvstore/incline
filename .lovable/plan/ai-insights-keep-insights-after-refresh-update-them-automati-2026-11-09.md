# AI Insights: keep insights after refresh, update them automatically, and add a sales forecast

## What's wrong now (checked)
- The app has no permission to read or save insights in the saved-insights table. A security clean-up removed it, and both errors are silently ignored. Each new insight disappears on refresh; the last one saved is from 16 Oct.
- The browser saves the insights itself, after the AI step finishes. If the tab closes or that save fails, the insight is lost.
- Insights only appear when someone presses Generate. Nothing updates them on its own.
- The AI looks only at broad numbers (revenue, attendance, expiries, overdue, leads, frozen). It doesn't look at renewals, PT sales or trainers, and it gives no forecast.

## What you'll get
1. **Insights stay after refresh.** The latest insight for your branch loads instantly. It shows how old it is.
2. **Automatic updates:**
   - The insight updates on its own when it's older than 6 hours and you open the dashboard. The Refresh button still works.
   - A scheduled job builds a fresh insight for every branch each morning at 7 am India time.
   - The card checks for new results while it is on screen.
3. **New "Sales forecast" section on the card:**
   - **Renewal ratio:** renewed vs. due memberships, this month and last month.
   - **PT packages:** packages sold this month and their value, compared with last month.
   - **Trainer performance:** top 5 trainers by PT revenue, active clients and sessions done.
   - **Projected sales this month** = what's already collected, plus the current daily pace for the rest of the month, plus expected renewals (memberships due × renewal ratio × average plan value). Shown as a low / likely / high range.
   - **3–5 suggested ideas from the AI**, based on these numbers (for example: "6 PT packages expire this week; ask trainers to follow up").
4. Only owners and managers see the forecast and trainer numbers. Staff and trainers see the general insights only. Each branch sees only its own numbers.

## Technical details
- Migration: grant SELECT on `ai_dashboard_insights` to authenticated, plus ALL to service_role. Add a `forecast jsonb` column and an index on (branch_id, generated_at desc). Replace the per-user policies with branch-scoped SELECT using `(SELECT user_visible_branch_ids())`. Writes come only from the backend function, using service_role.
- New SQL function `dashboard_sales_forecast(p_branch uuid)`:
  - Built as a stable SECURITY DEFINER function with `rpc_guard_applies` and branch/role checks. EXECUTE is granted to authenticated and service_role.
  - Calculates renewal ratio from memberships and renewal cases, PT sales from `member_pt_packages`, trainer stats from PT packages, sessions and commissions, and month-to-date revenue from completed payments. Uses IST month boundaries.
  - Returns the projected range.
- `ai-dashboard-insights` v3.0.0:
  - Calls the forecast function and passes those numbers into the AI prompt. The prompt asks for insights plus suggested ideas.
  - Saves the row on the backend with a branch-level 6-hour reuse check, so double clicks don't trigger another AI call.
  - Accepts a service-role "all branches" mode for the scheduled job.
- pg_cron daily at 01:30 UTC (07:00 IST), using the existing `x-internal-token` pattern to call the function once per active branch.
- Widget rewrite:
  - TanStack Query, with the role-gated forecast panel built from cards and badges.
  - Auto-refresh when the saved insight is older than 6 hours. Re-checks every 5 minutes while the card is on screen.
  - Errors are shown on the card; no silent failures.
  - Accessibility: `aria-live` updates and a labelled Refresh button.
  - Analytics events `ai_insights_refreshed` and `ai_insights_viewed`.
- Tests: projection math (Deno test) and the stale-check helper (unit test).
