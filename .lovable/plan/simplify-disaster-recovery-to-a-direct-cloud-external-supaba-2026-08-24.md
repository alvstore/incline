# Simplify Disaster Recovery to a Direct Cloud → External Supabase Dump

## What is true today (verified)

- The backup already runs **directly from Lovable Cloud to the external Supabase project** (`pmznpbsahetwmogezhff`) — no GitHub involved in the data path.
- A nightly scheduled job `dr-replicate-nightly` (21:00 UTC) mirrors schema + auth users + table rows + storage files into that project.
- A manual "run mirror / verify" card already exists in the app (System Health → Disaster Recovery).
- The only GitHub/CLI pieces are `scripts/dr/sync-edge-functions.sh` and two runbook docs — plus a "DR mode" freeze feature (banner + write-blocking flag) meant for a real failover switchover.

So the answer to the question: yes — nothing needs to move to Supabase-as-secondary, it already is. What we can remove is the CLI/GitHub layer and the failover machinery you don't want.

## What changes

1. **Delete the CLI/GitHub layer**
   - Remove `scripts/dr/sync-edge-functions.sh` and the `scripts/dr` folder.
   - Remove `docs/dr-runbook.md` and `docs/dr-secrets-checklist.md` (they describe CLI steps that no longer exist).

2. **Retire the failover ("DR mode") UI**
   - Remove the freeze banner and its hook from the app shell, and the failover controls from the Disaster Recovery card.
   - The database-side write-guard flag stays in place but dormant (never set by any app code) so nothing breaks; it can be dropped later if wanted.

3. **Keep and sharpen the dump**
   - Nightly full mirror stays exactly as-is.
   - The Disaster Recovery card becomes a clean two-button panel: **Run dump now** (full mirror with live progress) and **Verify parity** (per-table and per-bucket row/byte diff), plus last-run time, duration and any errors.

4. **Set expectations in the card**
   - Add a short note: the standby holds schema, data, auth users and files. Edge functions are **not** auto-deployed there anymore; on a real disaster they get deployed from this project in one step.

## Trade-off to be aware of

Dropping `sync-edge-functions.sh` means the standby project will not keep a live copy of the edge functions. For a "dump / cold standby" posture that is fine — recovery is: point a project at the mirrored database, then deploy functions. If you ever want hot failover instead, the freeze mode and function sync would need to come back.

## Technical notes

- Files touched: delete `scripts/dr/*`, `docs/dr-runbook.md`, `docs/dr-secrets-checklist.md`; edit `src/components/system/DisasterRecoveryCard.tsx`; remove `src/components/system/DrBanner.tsx` + `src/hooks/useDrMode.ts` and their mount points.
- No database migration, no change to `dr-replicate` (v1.5.0) or the `dr-replicate-nightly` cron.
- The `dr_mode` setting row and `dr_block_writes` trigger remain in the database, unused.
