## DR sync audit — findings

I audited `dr-replicate` v1.2.0 against the live primary. Two real gaps confirmed, one verification gap.

### 1. Storage: deep folders are silently skipped (CRITICAL)

`syncStorage()` only recurses **one level** into each bucket. Live data:

| bucket | objects | max folder depth |
|---|---|---|
| attachments | 26 | **3** ← truncated today |
| member-photos | 17 | 2 ✓ |
| avatars | 6 | 2 ✓ |
| contract-pdfs | 2 | 2 ✓ |
| products | 2 | 2 ✓ |
| documents | 1 | 2 ✓ |
| org-assets | 1 | 1 ✓ |

Every file under `attachments/<a>/<b>/<c>` (chat media, etc.) is currently NOT being mirrored. The function lists a folder, opens it one level, and stops — depth-3 paths fall through.

### 2. Schema snapshot is a stub (HIGH)

`syncSchemaSnapshot()` calls a `pg-meta` URL that isn't reachable that way, catches the failure silently, and uploads a placeholder `.sql` that just says "use the repo dump." So nightly schema parity is effectively not happening.

### 3. No parity verification (MEDIUM)

After a sync we have no automated answer to "are primary and standby 1:1 right now?" — we rely on the per-table counter in the report, which can show "0 rows" for an empty table just as easily as for a sync failure.

### Out of scope (already correct)

- Row mirror via `dr_get_replication_tables()` — verified, OK.
- `auth.users` mirror — OK.
- Bucket creation on standby — OK.

---

## Plan

### Step 1 — Fix storage deep recursion
Edit `supabase/functions/dr-replicate/index.ts` → rewrite the inner listing inside `syncStorage()` to walk arbitrary depth:

- Replace the one-level loop with a BFS queue of prefixes.
- For each prefix, call `POST /storage/v1/object/list/<bucket>` with `{ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }`, paginate until `< limit` returned.
- Items where `metadata.size != null` → file (queue for copy). Items where `metadata == null` AND `id == null` → folder (push `${prefix}${name}/` to queue).
- Keep the existing download/upload + upsert logic; add per-bucket counters.

### Step 2 — Real schema dump
Replace the stub `syncSchemaSnapshot()` with a working introspector that runs against primary via `service_role` and uploads a real DDL `.sql` to standby `dr-snapshots/<utc-date>.sql`. Use `pg_catalog` queries through a new SECURITY DEFINER RPC `public.dr_dump_schema()` returning the full DDL as `text` (we already use the same pattern for `dr_get_replication_tables` and `dr_get_cron_manifest`). The RPC concatenates:
1. enums, sequences, tables (`pg_get_tabledef` via pg_dump-style construction)
2. FKs/uniques/checks (`pg_get_constraintdef`)
3. indexes (`pg_get_indexdef`)
4. views (`pg_get_viewdef`)
5. functions (`pg_get_functiondef`)
6. triggers (`pg_get_triggerdef`)
7. RLS policies (`pg_policies`)
8. grants (`information_schema.role_table_grants`)

Edge function reads the RPC output, writes it as a single blob to standby Storage. No client-side concatenation, no fake placeholder.

### Step 3 — Parity verification endpoint
Add a 5th mode `"verify"` to `dr-replicate` that:
- For each table in `dr_get_replication_tables()`: `count(*)` on primary vs standby.
- For each storage bucket: object count + total bytes on primary vs standby.
- Returns a diff JSON `{ tables: [{name, primary, standby, delta}], storage: [...], ok: boolean }`.

User can run this after the nightly job and immediately see drift.

### Step 4 — Run, test, report
After deploy:
1. Invoke `dr-replicate` with `{ mode: "storage" }` → expect all 55 objects copied (currently fewer due to bug).
2. Invoke with `{ mode: "schema" }` → expect a real multi-KB SQL dump uploaded.
3. Invoke with `{ mode: "verify" }` → expect `ok: true` with zero deltas.
4. Paste the verify JSON into the response so you can confirm 1:1.

### Files touched

```text
supabase/functions/dr-replicate/index.ts        (rewrite syncStorage + syncSchemaSnapshot + add verify)
supabase/migrations/<ts>_dr_dump_schema.sql     (new RPC: public.dr_dump_schema())
supabase/migrations/<ts>_dr_verify_helpers.sql  (new RPC: public.dr_table_counts())
docs/dr-runbook.md                              (document verify mode + new behavior)
```

No frontend changes. No schema changes to business tables. Bumps `dr-replicate` to **v1.3.0**.
