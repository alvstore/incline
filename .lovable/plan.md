# Questionnaire audit error — one fix plan

## Cluster 1 — 3 occurrences

**Most likely root cause, confirmed in the earlier function definition:** `get_trainer_client_health` converted the member UUID to text when inserting its view audit entry. `audit_logs.record_id` requires a UUID, so the insert failed and the entire questionnaire lookup returned HTTP 400. This is a database type mismatch, not a Safari problem. All three occurrences share this one cause.

## Exact files and minimal fix

- Faulty definitions: `drizzle/migrations/0089_trainer_health_guidance.sql` and `drizzle/migrations/0090_member_health_view_access.sql`.
- Existing corrective definition: `drizzle/migrations/0091_fix_health_brief_audit_record_id.sql`, line 18.
- Minimal SQL change in the audit insert:

```diff
- p_member_id::text
+ p_member_id
```

Keep the authorization checks, questionnaire extraction, audit logging and grants unchanged. No change is needed in `src/hooks/useTrainerHealth.ts` or `/my-clients` presentation code.

## Current status

The live database function already contains the corrected UUID expression, matching migration 0091. The selected error remains open with its last occurrence at **21 October 2026, 18:37:13 UTC** (22 October, 00:07:13 IST). This audit has not reproduced a fresh failure; the saved finding alone does not establish that the corrected function still fails.

**Files to edit now: none unless verification reproduces a regression.** Do not modify applied migration history or add a duplicate correction.

## Focused verification and closure

1. Sign in as an authorized trainer, open an assigned client's Goals & health panel on `/my-clients`, and confirm questionnaire answers load.
2. Confirm the view audit entry saves with that client's UUID and the selected fingerprint receives no new occurrence.
3. Verify an unlinked trainer remains refused; do not broaden health-data access to fix this type error.
4. Only after those checks pass, resolve this selected finding; leave every other finding untouched.

If a fresh request reproduces the error, inspect its database error context and deployed function before applying one new corrective migration. Do not assume the already-correct UUID expression needs another replacement.

## Audit scope

Read-only database and source inspection; no application/database changes and no findings resolved.