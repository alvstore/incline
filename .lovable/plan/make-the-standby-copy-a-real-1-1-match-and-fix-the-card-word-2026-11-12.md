# Make the standby copy a real 1:1 match and fix the card wording

## What the last check actually found (12 Nov, 2:37 AM)
The copy isn't missing things because the app changed. It's missing them because the standby server **refused three kinds of writes**. The card then gives the wrong reasons.

| Card | Shows | Real cause |
|---|---|---|
| Structure & rules | 118 differences | 59 record links to sign-in accounts (e.g. members → account, invoices → created by) could not be created: "permission denied for table users". Each is counted twice (create + validate) = 118. |
| Records | 270/273, "changed since the copy" | Wrong wording. Sign-in accounts (265 vs 246) and sign-in identities (502 vs 468) were **refused** ("permission denied"). 1 contract signature request clashed with an old open request already on the standby (duplicate key). |
| Scheduled jobs | "Paused · 18 job(s) differ" | The 18 jobs were never put on the standby, so the check counts them as missing. That's a real gap, but the card mixes up "paused" (expected) with "missing". |
| Files | 3,055 · every file matches | Correct. |

The 11 Nov 1:07 PM run was an exact match. The runs since then lost access to the sign-in area, after the copy helpers on the standby were reinstalled (v2.2.0).

## Fix
1. **Restore standby permissions.** Reinstall the two copy helpers on the standby under the server's admin owner. That gives them access to sign-in accounts, identities, links to accounts and scheduled jobs again. The self-heal step will check the owner on every run and fix it if it drifts again.
2. **Contract signature request clash.** When copying a table with a "one open item" rule, remove the stale standby row that holds the slot first, then write the primary's row. This stays generic, so any similar table is handled the same way.
3. **Scheduled jobs.** Copy all 18 jobs to the standby, paused. If the scheduler refuses, the run reports the exact reason instead of a silent "missing".
4. **Honest card wording:**
   - Structure: count each link once and say "links to sign-in accounts couldn't be created on the standby". No more double counting.
   - Records: say "N table(s) couldn't be copied". Show the reason per table in See details, e.g. "standby refused access" or "conflicting old row". Keep "changed since the copy" only for genuine timing differences.
   - Jobs: say "18 job(s) not on the standby yet" separately from "kept paused".
   - The "Small differences" badge becomes "Needs attention" whenever a write was refused, because that isn't a small difference.
5. **Verify:** run Copy now, then Check match. Expect 0 / 273/273 / all files / 18 jobs paused, and the badge back to Exact match.

## Technical details
- Files: `supabase/functions/dr-replicate/standby.ts` (helper install: `ALTER FUNCTION ... OWNER TO postgres` and an owner check in self-heal), `rows.ts` (on a unique violation in `dr_mirror_replace`, delete the conflicting standby rows by the violated unique key, then retry once), `jobs.ts`/`run.ts` (surface the jobs step error, verify report gets `jobs.error`, constraint+validate deduplicated in the verify summary), `src/lib/dr/standbyCopy.ts` (add a `failures` reason map to VerifyReport tables, and a "Needs attention" status when refusals exist), `src/components/system/DisasterRecoveryCard.tsx` (captions/details).
- Bump dr-replicate to v2.3.0, deploy, update `dr_test.ts` for the dedupe and unique-conflict retry, and run it.
- The first step confirms the helper owner on the standby before changing anything. If the owner isn't the cause, the permission fix changes to match what that check finds.
- No changes to the main app's data.
