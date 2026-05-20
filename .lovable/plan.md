
# Analytics Audit — Avg Session Duration & Earnings Reports

## 1. Avg Session Duration — what the code does today

File: `src/pages/Analytics.tsx` lines 307–338.

```ts
supabase.from('member_attendance')
  .select('check_in, check_out')
  .gte('check_in', subDays(now,14))
  .not('check_out','is',null);            // ❶
// per row:
const dateKey = row.check_in.split('T')[0]; // ❷ UTC date
const durationMin = (checkOut - checkIn)/60000;
if (durationMin<=0 || durationMin>480) return; // ❸ silent drop
byDay[date].total += durationMin;
byDay[date].count++;                       // ❹ per-session avg, not per-member
```

### Problems found

| # | Severity | Finding |
|---|---|---|
| ❶ | **Critical** | Turnstile auto-creates `check_in`; check-out is **manual** by staff. So a huge share of sessions never get `check_out`. The query throws them away → "average" is computed only on the minority that staff happened to close. Result is biased toward members who train late or who staff personally noticed leaving. |
| ❷ | High | `check_in.split('T')[0]` uses the raw ISO string (UTC). For India (UTC+5:30) any check-in before 05:30 IST gets bucketed to the previous day. Late-night sessions are split across two days. |
| ❸ | Medium | `>480 min` (8 h) outliers are silently dropped. With no auto-close, "ghost" sessions can sit open for days; when staff finally taps "check out" the next morning the duration is enormous → dropped, but the underlying data integrity problem is invisible. |
| ❹ | Medium | Label says *"Average time **members** spend per day"* but math is **avg per session**. A member with two sessions in a day counts twice; the metric drifts when behaviour (not duration) changes. |
| ❺ | Low | No `branch_id` filter when "All branches" is selected and user is owner — fine, but `member_attendance` is already RLS-scoped so cross-branch owners see everything; UI label should clarify scope. |

### Fix plan (Avg Session Duration)

1. **Auto-close stale sessions** (root cause):
   - New pg_cron job `auto_close_stale_attendance` running every 15 min, plus a one-shot backfill.
   - Closes any `member_attendance` row where `check_out IS NULL` AND `check_in < now() - interval '6 hours'` (configurable per branch via `settings.auto_close_minutes`, default 360).
   - Sets `check_out = check_in + interval '<branch_avg_or_90min>'`, `notes = 'auto-closed: no manual checkout'`, and a new column `check_out_method = 'auto'`.
   - Logs to `audit_log` so staff visibility is preserved.
2. **New column** `member_attendance.check_out_method text` (values: `manual`, `auto`, `turnstile`). Existing rows backfilled as `manual`.
3. **Rewrite the metric** as a server-side RPC `analytics_session_duration_daily(p_branch uuid, p_days int)`:
   - Bucket by `date_trunc('day', check_in AT TIME ZONE 'Asia/Kolkata')`.
   - Compute **per-member-per-day average**: `avg(member_day_total_minutes)` where `member_day_total_minutes = sum(duration) per (member_id, day)`.
   - Exclude `check_out_method = 'auto'` from the numerator by default (toggle in UI: *Include estimated sessions*).
   - Cap individual session at 240 min for the avg but return a separate `dropped_count` so the UI can show a data-quality chip.
4. **UI refinements** in the Avg Session Duration card:
   - Sub-label: *"Per member, per visit day · Asia/Kolkata · manual check-outs only"*.
   - Small chip: `12% auto-closed (excluded)` when applicable, with tooltip.
   - Empty/low-confidence state when `manual_checkout_ratio < 30%` → show a banner *"Not enough manual check-outs to compute reliably — ask staff to tap Check-out at exit."*

## 2. Earnings Reports — what the code does today

Three queries power the revenue surfaces:

| Source | Lines | Reads from | Filter |
|---|---|---|---|
| Revenue trend (12 mo) | 66–85 | `payments.amount` | `status='completed'`, month window via `.toISOString()` |
| Weekly earnings | 145–162 | `payments.amount` | week window via UTC ISO |
| Revenue by plan | 127–143 | `memberships.price_paid` | none (includes cancelled/refunded) |

### Problems found

| # | Severity | Finding |
|---|---|---|
| A | **Critical** | Month/week boundaries use `startOfMonth(date).toISOString()` (UTC). A payment recorded 1-Jun 01:00 IST = 31-May 19:30 UTC → attributed to **May**, not June. Every month boundary leaks ~5h30m of payments to the previous month. |
| B | **Critical** | "Revenue by plan" reads `memberships.price_paid`, not `payments`. So it includes (a) memberships that were later cancelled, (b) plans with unpaid dues, (c) reversed purchases. The total does **not** reconcile with the trend chart, breaking the dashboard's internal consistency. |
| C | High | Only `status='completed'` is summed. The codebase has a payment lifecycle (`lifecycle_status`, `reversal_of`, `voided_at`) — a payment can stay `completed` while being reversed by another row. The current sum double-counts reversed payments. |
| D | High | 12 sequential round-trips to Supabase for one chart (one query per month). Should be a single GROUP BY. |
| E | Medium | `weeklyEarnings` uses `getDay(new Date(p.payment_date))` — UTC day-of-week. Same TZ bug as (A). |
| F | Medium | No exclusion of `payment_source = 'wallet_topup'` / internal transfers if any — needs confirmation against `record_payment` RPC contract. |
| G | Low | Branch-scoped owners switching branches refetches every chart; queries are not parallelised through a single RPC. |

### Fix plan (Earnings)

1. **Single canonical RPC** `analytics_revenue_series(p_branch uuid, p_from date, p_to date, p_grain text)` returning rows `{period, gross, refunds, net, count}`:
   - Source: `payments` only.
   - Net formula:
     ```
     net = sum(amount) FILTER (status='completed' AND voided_at IS NULL AND reversal_of IS NULL)
         - sum(amount) FILTER (status='completed' AND reversal_of IS NOT NULL)
         - sum(amount) FILTER (status='refunded')
     ```
   - Bucket by `date_trunc(p_grain, payment_date AT TIME ZONE 'Asia/Kolkata')`.
   - Honors `branch_id` and `has_capability('view_financials')` server-side.
2. **Replace three client queries** with this RPC:
   - Trend chart calls it with `grain='month'`, range = last 12 months in IST.
   - Weekly card calls it with `grain='day'`, range = current ISO week in IST.
   - Top-line revenue / collection-rate uses the same source (single source of truth).
3. **Fix "Revenue by plan"**: new RPC `analytics_revenue_by_plan(p_branch, p_from, p_to)` that joins `payments → invoices → invoice_items → memberships → membership_plans` (or follows `payments.invoice_id`) so it reflects **actual money received**, not nominal plan price. Excludes refunds/reversals identically.
4. **UI**:
   - Chart tooltip shows `Gross ₹X · Refunds ₹Y · Net ₹Z` so staff can see why net differs from gross.
   - Period chip on every revenue card: *"IST · net of refunds & reversals"*.
   - Add small badge on each card with last-refresh time.
5. **Internal consistency check** (dev-only): a `useEffect` warning if `sum(trend chart) !== sum(weekly) for overlapping range` — prevents regression.

## 3. Files to change

```text
supabase/migrations/<ts>_attendance_auto_close_and_analytics_rpcs.sql
  - alter table member_attendance add column check_out_method text default 'manual'
  - backfill + index (branch_id, check_out) where check_out is null
  - function auto_close_stale_attendance()
  - pg_cron 'auto-close-attendance' every 15 min
  - function analytics_session_duration_daily(...)
  - function analytics_revenue_series(...)
  - function analytics_revenue_by_plan(...)
  - grants to authenticated; SECURITY DEFINER + search_path pinned
src/pages/Analytics.tsx
  - replace 4 client queries with RPC calls
  - per-card data-quality chips, IST labelling, lifecycle-aware tooltips
src/services/analyticsService.ts  (new, small)
  - typed wrappers around the new RPCs
mem://features/analytics-financial-and-attendance-metrics (new note)
```

## 4. Out of scope (call out, don't build)

- Turnstile-driven auto check-out (hardware tap on exit) — separate MIPS work.
- Backfilling historical "true" session durations for the past — impossible without exit data; we only fix forward.
- Tax-split / GST reporting (already covered by GST report engine).

## 5. Technical notes

- All new SQL functions: `SECURITY DEFINER`, `SET search_path = public`, `STABLE` where read-only.
- Time-zone constant: `'Asia/Kolkata'` (single source — already implicit project-wide).
- `auto_close_stale_attendance` writes through normal trigger paths (DR-mode honored automatically by `dr_block_writes`).
- No changes to `record_payment` RPC; we only **read** through a new lens.
- All charts continue to honor `BranchContext` via the `p_branch` argument.

