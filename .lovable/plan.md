# Renewal Center: automatic case for every membership cycle

## What the audit found (live data, 7 Nov)

The Renewal Center is designed as "one case per membership". When a member renews, the old case closes as Renewed and the new membership should get its own case when it nears expiry. That second step never happens.

1. **New cases stopped being created on 11 Sep.** The function that opens cases (`detect_renewal_cases`) was run once by hand at launch and is not scheduled anywhere — no cron job, no Automation Brain rule, and the daily Renewal Engine tick never calls it (it also exits early because the engine is switched off). Newest case in the table: 11 Sep 2026.
2. **Result:** 3 members renewed in September, their renewed memberships then expired (27 Oct, 28 Oct, 1 Nov), and none of them appear in the Renewal Center — their only case still says "Renewed". Upcoming expiries for every other member are also missing.
3. **Wrong outcomes on closed cases.** On 17 Oct a bulk sweep closed cases as Churned / Win-back without checking for a paid follow-on membership. 1 case is "Churned" and 1 is "Win-back" although the member has a paid, active membership (should be Renewed). Because they are closed, the reconciliation loop never re-checks them.
4. Reconciliation (marking Renewed when a paid successor appears) works correctly via trigger + detector, so the "renewed" half of the cycle is fine.

## Fix

1. **Schedule detection independently of messaging.** Add an Automation Brain rule `detect_renewal_cases` (RPC worker, daily 06:00 IST + hourly light pass) so cases open for every membership expiring within 21 days or expired within 30 days — regardless of whether outbound reminders are enabled. Messaging stays off until you switch the engine on.
2. **Open the next cycle instantly.** Extend the existing membership trigger: when a membership becomes active, close any older open case as Renewed (already done) and, if the new membership is already inside the 21-day window, open its case immediately. Expiry status changes also refresh the case's stage (due soon → today → lapsed) without waiting for the daily run.
3. **Correct mislabeled closed cases.** One-time repair: any closed Churned / Win-back / Not-interested case whose member has a paid successor membership covering past the old expiry is relabelled Renewed (with a "corrected by audit" timeline event). Future churn sweeps must check for a paid successor first.
4. **Backfill now.** Run detection once after deploy so the 3 lapsed renewers and all upcoming expiries appear immediately; report counts opened.
5. **Visibility in the Renewal Center.** Show "Last scan: <time> · N cases opened" in the header (from the rule's run history) and a "Cycle 2/3…" badge on a member's case when they've renewed before, linking to the prior case. Failures appear in Automation Brain like other rules.

## Technical details

- Migration: `automation_rules` row (`worker: rpc:detect_renewal_cases`, service-role only as today); patch `tg_renewal_case_sync` to upsert a case for `NEW` when `end_date` within window (ON CONFLICT membership_id); add successor guard to the churn/lapse path in `detect_renewal_cases`; audited repair UPDATE + `log_renewal_case_event('stage_corrected')`.
- Add `renewal_center_queue` output `cycle_number` (count of prior cases for member) and a small `renewal_scan_status()` read RPC for the header (capability `manage_renewals`).
- Tests: SQL scenario test — member renews → old case Renewed; new membership enters window → new case opens; new membership expires → shows in Lapsed; churned case with paid successor → corrected. Plus a hook/UI test for the cycle badge.
- No messages are sent; reminder engine remains disabled.
