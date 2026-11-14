# Renewal Center: one live case per member, closed cycles become history

## What's wrong today
- The "All" tab shows every renewal case ever opened, including ones already renewed, lost or cancelled. So a renewed member sits in both "All" and "Renewed" forever.
- Each membership cycle opens a fresh case. When a member expires and renews again, a new case appears while the old "Renewed" row stays, so the same person shows up repeatedly and the dashboard feels like a loop.
- "Renewed" has no time window, so it only grows (10 today, more every month).

## New logic (cycle-aware)
- **One open case per member.** Work tabs (Needs action, Due soon, Today, Lapsed, Voice, Callback) only show open cases. Closed cases never appear there.
- **"All" becomes "Active pipeline"**: open cases only.
- **Outcomes tab** replaces Renewed/Lost lists: closed cases from a chosen period (default this month: This month / Last 30 days / 90 days), each row showing the outcome and the closed date. Old cycles drop out naturally.
- **Repeat cycles shown as history, not duplicates.** Each row gets a small "Cycle 3 · renewed 2x before" chip; opening a member shows a timeline of all past cycles (expired → contacted → renewed on date) in a side panel.
- When the renewal engine opens a new cycle for a member, any older still-open case for that member is closed as superseded, so a member never has two live rows.
- KPI cards become period-based: Renewal rate this month, Renewed this month, At risk now, Lapsed now — instead of all-time totals.

## Redesign (same feel as Approvals and Tasks)
- Title letters rise in, stat cards enter one after another, counts animate up.
- Pipeline strip at the top: Due soon → Today → Lapsed → Voice → Callback → Won/Lost this month, with animated bars; clicking a stage filters the list.
- Rows: urgency colour by days to expiry (green upcoming, amber within 3 days, red lapsed), a cycle chip, last contact, owner.
- Closing a case (renewed/lost) animates the row out of the work list with a 5-second Undo, then it appears in Outcomes.
- Loading skeletons, "Nothing to chase today" empty state, filtered-empty message, and error with Retry.
- Theme tokens only, works in dark mode, reduced motion respected, phone layout with scrolling stage chips.

## Rollout
- Behind a per-branch switch `renewal_center_v2` (off → current screen), so it can be turned back instantly.
- Analytics events: `renewal_case_claimed`, `renewal_case_outcome_recorded`, `renewal_tab_viewed` (no member names or phone numbers).

## Technical details
- Migration: update `renewal_center_queue` — `all` → `closed_at IS NULL`; new `_queue='outcomes'` with `_since date` filtering `closed_at >= _since`; add `cycle_number` and `prior_renewals` (window count over member's cases). Keep existing tab keys so nothing else breaks.
- Update `renewal_queue_counts` and `renewal_funnel` to match (open-only counts; won/lost scoped to period).
- `detect_renewal_cases`: when inserting a case for a member, close older open cases for that member with `outcome='superseded'`, `closed_at=now()`, logged in `renewal_case_events`. Add partial unique index `renewal_cases(member_id) WHERE closed_at IS NULL` after cleaning existing duplicates (verified current data has one case per member, so cleanup is a no-op check).
- New RPC `renewal_member_history(member_id)` (branch-guarded with `rpc_guard_applies`) for the timeline panel.
- Frontend: `RenewalCenter.tsx` split into PipelineStrip, CaseList, OutcomesView, MemberCycleSheet; reuse the GSAP helpers used by Approvals/Tasks. Hook changes in `useRenewalCenter.ts`.
- Tests: a small test for the cycle/urgency helper (days → colour bucket, superseded handling). Voice calling, claim/snooze and outcome actions unchanged.
