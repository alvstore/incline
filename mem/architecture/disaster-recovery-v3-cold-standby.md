---
name: Disaster Recovery v3 — Cold Standby Dump
description: DR is a direct Cloud→external Supabase dump (dr-replicate nightly + manual). No CLI scripts, no failover freeze UI.
type: feature
---

- DR = **cold standby dump**, primary → external Supabase project `pmznpbsahetwmogezhff`, direct from the `dr-replicate` edge function (v1.5.0). No GitHub/CLI in the data path.
- Schedule: pg_cron job `dr-replicate-nightly`, `0 21 * * *` UTC (02:30 IST), mode `all` (schema + auth users + rows + storage).
- Manual controls live in `src/components/system/DisasterRecoveryCard.tsx` (owner-only, inside Settings → Backup & Restore): **Run dump now** (`mode: all`) and **Verify parity** (`mode: verify`).
- Removed Aug 2026: `scripts/dr/sync-edge-functions.sh`, `docs/dr-runbook.md`, `docs/dr-secrets-checklist.md`, `src/components/system/DrBanner.tsx`, `src/hooks/useDrMode.ts`. Do NOT re-add unless hot failover is explicitly requested.
- Edge functions are NOT mirrored to the standby. Recovery = point at mirrored DB, then deploy functions from this project.
- The `dr_mode` setting row and `dr_block_writes` trigger still exist in the database but are dormant — no app code sets them.
