## Goal
Replace the stale `/mnt/documents/incline_full_schema.sql` (dated Apr 17) with a fresh, single-file dump generated from the **live Lovable Cloud database** as of today, and delete any other ad-hoc `.sql` artifacts.

## Audit findings
- Only one schema artifact exists in artifacts: `/mnt/documents/incline_full_schema.sql` (358 KB, last written Apr 17, 2026 — stale by ~6 weeks).
- No other loose `.sql` files exist outside `supabase/migrations/` (the migration history will be left untouched).
- The dump must reflect the current live DB which has had many migrations since (P3/P4 hardening, comms dispatcher, IG comment→DM, HRM contracts v2, etc.).

## What I will do (in build mode)

1. **Audit the live DB** via `supabase--read_query` against `pg_catalog` / `information_schema` to enumerate, in `public` schema only:
   - Extensions
   - Enums (`pg_type` where `typtype='e'`)
   - Tables + columns + defaults + constraints (PK/FK/UNIQUE/CHECK)
   - Indexes (non-PK)
   - Sequences
   - Views & materialized views
   - Functions & procedures (with full bodies via `pg_get_functiondef`)
   - Triggers (via `pg_get_triggerdef`)
   - RLS policies (via `pg_policies`)
   - Table/sequence GRANTs (via `information_schema.role_table_grants`)
   - `supabase_realtime` publication members
   - `pg_cron` jobs (from `cron.job` if visible)

2. **Assemble a single ordered file** `/mnt/documents/incline_full_schema.sql`:
   ```text
   -- Header: generated timestamp, project ref, source = live DB
   1. EXTENSIONS
   2. ENUMS
   3. SEQUENCES
   4. TABLES (CREATE TABLE ... with inline defaults)
   5. CONSTRAINTS (PK, FK, UNIQUE, CHECK — added after all tables to avoid order issues)
   6. INDEXES
   7. VIEWS / MATERIALIZED VIEWS
   8. FUNCTIONS (pg_get_functiondef output, one per block)
   9. TRIGGERS
   10. GRANTS
   11. RLS: ALTER TABLE ... ENABLE RLS  +  CREATE POLICY ...
   12. REALTIME publication
   13. CRON jobs (commented, informational)
   ```
   File will be self-contained and replayable on an empty Postgres+Supabase project.

3. **Delete stale artifacts**:
   - Overwrite (replace) `/mnt/documents/incline_full_schema.sql` with the fresh dump.
   - No other loose `.sql` dump files exist to delete; `supabase/migrations/**` will NOT be touched.

4. **Deliver** the new file via `<presentation-artifact>` so you can download it.

## Out of scope
- No code or migration files will be modified.
- Migration history under `supabase/migrations/` stays intact (you previously rejected flattening it).
- No DB writes — read-only introspection queries only.

## Technical notes
- Will use `supabase--read_query` (read-only) to pull all introspection in a handful of large queries, then assemble the SQL string in a Node/Bun script under `/tmp/` and write the final file to `/mnt/documents/`.
- Roughly expect 200+ tables, 300+ policies, 150+ functions — final file likely 500 KB – 1.5 MB.
