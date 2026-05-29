## Audit findings — primary vs DR standby

**Primary**: `iyqqpbvnszyrrgerniog.supabase.co`
**Standby**: `pmznpbsahetwmogezhff.supabase.co`
**Daily job**: `dr-replicate-nightly` cron → `dr-replicate` edge fn (02:30 IST)

### What is being mirrored today (verified in `supabase/functions/dr-replicate/index.ts` v1.1.0)

| Layer | Status |
|---|---|
| `auth.users` (id, email, phone, metadata) | Mirrored |
| Storage buckets (definition) | Mirrored |
| Storage object bytes | Mirrored |

### What is NOT being mirrored — gaps (per `docs/dr-runbook.md` lines 126–133 and code inspection)

| Layer | Status | Risk |
|---|---|---|
| **`public.*` table rows** (members, memberships, invoices, payments, leads, comms logs, attendance, everything) | NOT mirrored | Catastrophic — standby has empty business tables |
| **Schema migrations** (new tables, columns, RLS, functions, triggers) | NOT mirrored | Standby drifts every time a migration ships |
| **Edge function code** (~70 functions) | NOT mirrored | Standby cannot serve API at failover |
| **`pg_cron` schedules** (automation-brain-tick, send-reminders, IG runs, etc.) | NOT mirrored | No automations run after failover |
| **Project secrets** (Razorpay, Meta, Round SMS, Lovable AI, etc.) | NOT mirrored | All integrations dead at failover |
| **Extensions / custom roles** | Assumed identical, not verified | Possible failover surprise |
| **`backup` edge fn EXPORT_TABLES list** | Stale — missing ~40 tables that exist today (ai_knowledge, automation_rules, hrm_contracts, ig_comment_*, campaign_recipients, contact_segments, ai_tool_usage, dispatch logs, retry queues, etc.) | Manual export is incomplete |

**Bottom line:** today's "DR" is really just **auth + files mirror**. The standby cannot actually serve the app if primary dies, because it has 0 business rows and no edge functions.

---

## Plan to reach true 1:1 parity

Five workstreams. Each can ship independently; ordering below is recommended.

### 1. Database rows (the biggest gap) — extend `dr-replicate` to mirror public.* tables

Add a **third pass** to `dr-replicate/index.ts` that:

1. Reads canonical table list + dependency order from a new server function `public.dr_get_replication_tables()` (returns ~120 tables in FK-safe order). Single source of truth, lives in DB so adding a new table doesn't require redeploying the edge fn.
2. For each table, paginates with `range()` 1 000 rows at a time (Supabase limit) and `upsert({onConflict: 'id', ignoreDuplicates: false})` into standby.
3. Skips columns that are computed/generated; relies on standby having identical schema.
4. Tombstone deletes: for tables with soft-delete (`deleted_at`), trust the column; for hard-delete tables (memberships, attendance), the function compares row counts and emits a warning when standby > primary (indicates orphan rows from an earlier sync — caller can run `?mode=purge` to truncate-and-refill those tables).
5. Returns counters in the existing report JSON.

**Why an RPC for the table list:** the dependency order matters and changes as schema evolves; keeping it as a SQL function lets migrations register new tables without code deploys.

### 2. Schema mirror — apply the daily dump to standby

Add a fourth pass (`mode: "schema"`) that:

1. Calls our existing introspection (the same SQL used to generate `incline_full_schema.sql` today) against primary.
2. Wraps the result in a transaction and **executes on standby** using its `service_role` via the `pg-meta` REST endpoint (`/pg/query`). Idempotent statements only (`CREATE … IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `ALTER … IF EXISTS`).
3. Runs FIRST in the nightly job, before the data pass, so new columns exist when data arrives.

Fallback if `/pg/query` is blocked on standby: the function writes the dump to `dr-snapshots/<date>.sql` in standby Storage and the runbook documents a one-command `psql -f` to apply it.

### 3. Edge function code mirror — new `dr-deploy-functions` script

Add `scripts/dr/sync-edge-functions.sh` (kept out of nightly cron — runs on demand, since deploying live functions has rollout risk):

```
# uses Supabase CLI
supabase functions list --project-ref iyqqpbvnszyrrgerniog \
  | while read fn; do
      supabase functions deploy "$fn" \
        --project-ref pmznpbsahetwmogezhff \
        --import-map supabase/functions/import_map.json
    done
```

Document in runbook: re-run whenever a new function is added or edited.

### 4. pg_cron + secrets parity — manifest file + checklist

- Add `docs/dr-cron-manifest.sql` — the exact `cron.schedule(...)` block needed on standby. Generated once from `SELECT jobname, schedule, command FROM cron.job` on primary; checked into the repo.
- Add `docs/dr-secrets-checklist.md` — list of every secret that must exist on standby (names only, never values). Owner re-pastes values once at standby setup.

These two are intentionally manual: pushing cron schedules / secrets via the management API is risky (touches a live project), and they change rarely.

### 5. Fix the `backup` edge fn EXPORT_TABLES list

Replace the hard-coded array in `supabase/functions/backup/index.ts` with the same `public.dr_get_replication_tables()` RPC introduced in §1. Single source of truth for "what counts as the business dataset."

---

## Updated DR runbook outcomes

After all five workstreams land, the runbook table "What the standby does NOT mirror" shrinks from 4 items to 1 (secrets only, kept manual on purpose).

A daily standby will hold:
- Identical schema as of last night
- All `public.*` rows as of last night (≤24 h RPO)
- All `auth.users`
- All storage objects
- Identical edge function code (after manual sync trigger when fns change)
- Identical cron jobs (after one-time manifest apply)

At failover, the only remaining manual step is pasting the secrets and flipping DNS.

---

## Files to be added / changed (build mode)

- **DB migration**: `public.dr_get_replication_tables()` RETURNS SETOF text — single source of truth for tables + order.
- **Edge fn**: `supabase/functions/dr-replicate/index.ts` v1.2.0 — add schema pass + public.* row pass, accept `mode: "schema" | "rows" | "all"`.
- **Edge fn**: `supabase/functions/backup/index.ts` — use the new RPC instead of hardcoded list.
- **Script**: `scripts/dr/sync-edge-functions.sh` — wrapper around `supabase functions deploy`.
- **Docs**: `docs/dr-cron-manifest.sql`, `docs/dr-secrets-checklist.md`, updated `docs/dr-runbook.md` with new sections.
- **UI**: "Sync to fallback now" button in `/system-health` already exists; expose three sub-buttons (Schema · Rows · Storage+Auth) so owner can run any pass on demand. Default button keeps doing "all".

## Out of scope
- True streaming replication (requires Supabase logical-replication add-on; not enabled on this project).
- Mirroring `pg_cron.job_run_details` history.
- Mirroring vault secrets via API (Supabase does not expose vault secret values over HTTP).

## Open question for you (will not block plan approval)
Do you want the new nightly job to run **schema + rows** every night automatically, or only **rows** nightly with a **weekly** schema pass? Schema-pass-every-night is safer but burns more egress and locks tables briefly on standby. My recommendation: schema nightly, since the cost is negligible at our scale.
