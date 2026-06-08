# Audit & Fix — `/register` flow + DB error backlog

## What's broken (root cause)

**`/register` self-onboarding is completely broken since June 8 05:26 UTC.**

`error_logs` shows 7 consecutive `23514` failures in 2 minutes from the `register-member` edge function. All identical:

```
new row for relation "members" violates check constraint "members_lifecycle_state_check"
```

- `register-member/index.ts:421` inserts `lifecycle_state: "pending_plan"`.
- The CHECK constraint (migration `20260503131220`) only allows: `created · pending_verification · verified · active · onboarded · suspended · archived`.
- Result: every self-registration auth user gets created, then the member insert fails, the edge fn deletes the orphaned auth user — user sees a 500, no member created, no signed waiver, no CRM handoff.

`pending_plan` IS a real domain state per project memory ("Public Self-Onboarding → pending_plan CRM handoff") and the Members UI already pins/styles it (`Members.tsx:160-169`, badge `pending_plan: 'bg-warning/15…animate-pulse'`). It was simply never added to the constraint or the lifecycle state machine.

## Other findings in last 24h `error_logs`

| Source | Count | Verdict |
|---|---|---|
| `edge_function` / `23514` | **7** | The bug above — fix below |
| `ai_lead_loss` warning on `+918854869672` | 3 | Real — separate WhatsApp 24h-window issue, not this loop |
| `frontend` Network error | 4 | Transient client offline blips, not actionable |

No other DB constraint, RLS, or trigger errors in 24h. System otherwise green.

## Fix plan

### 1. Extend the lifecycle constraint to include `pending_plan`
One migration that drops + re-adds `members_lifecycle_state_check` with `pending_plan` appended, and teaches `transition_member_lifecycle` that `pending_plan → active` and `pending_plan → archived` are valid moves (so reception's "assign plan" still passes the state machine).

```text
allowed states (new): created · pending_verification · verified ·
                      pending_plan · active · onboarded · suspended · archived
```

This is the minimal-surface fix. It preserves every existing reference (`Members.tsx`, the badge, the pin-to-top sort, the edge fn) without renaming.

### 2. Backfill: nothing to clean
Those 7 inserts were rolled back atomically; no orphan member rows, no orphan auth users (the edge fn already deletes them on failure). Confirmed by row count check at the end of this plan.

### 3. Surface DB constraint failures in System Health
Add `database` + `edge_function` severity=`error` rows to the new AI Reply SLA tile area as a small "DB Integrity (24h)" card so the next constraint violation isn't only visible by querying psql. Uses existing `error_logs` table — no new tables.

### 4. Prevent recurrence
Add a one-line CI lint (`scripts/post-merge.sh` already exists) that greps every edge fn for `lifecycle_state:\s*['"]` and fails the build if the value isn't in the allowed-set constant. Cheap, no new tooling.

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Drop + re-add `members_lifecycle_state_check` with `pending_plan`; update `transition_member_lifecycle` allowed transitions; `NOTIFY pgrst`. |
| `src/components/system/DbIntegrityCard.tsx` | **NEW.** 24h roll-up of `error_logs` where source IN ('edge_function','database','trigger') AND severity='error'. |
| `src/pages/SystemHealth.tsx` | Mount `<DbIntegrityCard />` next to `<AiReplySlaCard />`. |
| `scripts/post-merge.sh` | Add lifecycle-state lint. |

## Verification

1. Hit `/register` end-to-end with a throwaway phone → expect 200, member row with `lifecycle_state='pending_plan'`, waiver PDF in storage, lead row updated.
2. `psql` → `SELECT lifecycle_state, count(*) FROM members GROUP BY 1` shows `pending_plan` rows present.
3. From Members page, click "Assign Plan" on a pending_plan member → state moves to `active` without RPC error.
4. `SELECT count(*) FROM error_logs WHERE error_message ILIKE '%members_lifecycle_state_check%' AND created_at > now() - interval '1h'` = 0.
5. DbIntegrityCard renders "Healthy" on the System Health page.

## Out of scope

- `ai_lead_loss` warning for `+918854869672` (separate WhatsApp 24h-window thread; will track in its own loop).
- Re-architecting member states (the 8-state machine is fine; only one value was missing).

