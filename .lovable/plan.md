## Audit — Meta functions

Note: `meta-diagnose` and `meta-subscribe` no longer exist — they were merged into `meta-admin` in the previous round. The remaining Meta-related functions are:

| Function | LoC | URL bound to | Can merge? |
|---|---|---|---|
| `meta-webhook` | 909 | Registered with Meta as the Instagram/Messenger webhook URL (verify token + signed payload receiver) | **No** — Meta calls this URL directly |
| `meta-oauth-callback` | 202 | Registered as the Instagram Business Login OAuth redirect URI; returns HTML / 302 to the app | **No** — Meta redirects browsers here; URL is hard-wired in the Meta App Dashboard |
| `meta-data-deletion` | 173 | Registered as the Meta GDPR "Data Deletion Request URL" (legal requirement) | **No** — Meta calls this when a user requests deletion |
| `whatsapp-webhook` | 1048 | Registered as the WhatsApp Cloud API webhook URL (separate from `meta-webhook`) | **No** — Meta calls this URL directly |
| `meta-admin` | (already merged) | Internal only (subscribe + diagnose) | already done |

**Verdict:** No further Meta merges are safe. Every remaining `meta-*` function is an externally-registered URL in the Meta App Dashboard. Renaming or folding them under a single dispatcher would require updating each registration in Meta (and re-verifying webhooks, OAuth, and GDPR endpoints) — high blast radius, zero internal benefit. They already share helpers via `_shared/meta-config.ts`, which is the right pattern.

What *can* improve in the Meta surface (separate from merging — flag only, not in this plan):
- `meta-webhook` is at 909 LoC and `whatsapp-webhook` at 1048 LoC. The two could share more ingestion/log helpers via `_shared/` — but that's a refactor, not a merge, and out of scope for this task.

---

## Merge plan — `backup-export` + `backup-import` → `backup`

Both functions:
- Run the same owner/admin gate (anon client `getUser` → `user_roles` lookup for `owner`/`admin`).
- Operate on the same table catalog (`TABLES` for export, `RESTORE_ORDER` for import — different ordering but the same domain).
- Have one caller each in `src/components/settings/BackupRestore.tsx`.

### New function

`supabase/functions/backup/index.ts` — single endpoint dispatched by body `action`:

- `action: "export"` → returns the JSON file with `Content-Disposition: attachment` (preserves current browser-download behavior).
- `action: "import"` → accepts `{ data, dry_run?, conflict_strategy? }`, returns `{ success, dry_run, summary }`.

Shared helpers defined once at the top of the file:
- `corsHeaders`, `jsonResponse`, `service-role client`, `anon-with-bearer client`
- `requireOwnerOrAdmin(authHeader): { user, supabase } | Response` — single auth gate used by both branches.
- Keep `TABLES` and `RESTORE_ORDER` as separate constants (they intentionally differ — export grabs all, import sequences by FK dependency).

### Caller updates

`src/components/settings/BackupRestore.tsx`:
- Export (line 39): change `…/functions/v1/backup-export` → `…/functions/v1/backup` and add `body: JSON.stringify({ action: 'export' })` with `Content-Type: application/json`. Keep the `fetch` flow (we still need the raw `Response` to download the file as a blob).
- Import (line 85): `supabase.functions.invoke('backup', { body: { action: 'import', ...payload } })`.

### Config

`supabase/config.toml`:
- Remove `[functions.backup-export]` and `[functions.backup-import]` blocks.
- Add `[functions.backup]` with `verify_jwt = true` (both originals were `verify_jwt = true`, and the function still validates roles in-code).

### Cleanup

- Delete `supabase/functions/backup-export/` and `supabase/functions/backup-import/`.
- `supabase--delete_edge_functions(["backup-export", "backup-import"])`.
- `supabase--deploy_edge_functions(["backup"])`.

### Validation

- BackupRestore UI export still triggers a JSON file download named `incline-backup-YYYY-MM-DD.json`.
- Dry-run import still returns per-table `summary` with `inserted/updated/skipped/errors`.
- Both branches still 401/403 for non-admins.

### Net change

- Removed: `backup-export`, `backup-import` (2 functions, 254 LoC)
- Added: `backup` (~280 LoC after deduping auth gate)
- No external URL changes; only one frontend file touched.

Proceed?