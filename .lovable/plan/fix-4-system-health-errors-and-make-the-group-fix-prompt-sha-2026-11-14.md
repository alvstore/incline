# Fix 4 System Health errors and make the group fix prompt sharper

## Part A — Fix the 4 errors

1. **"Start now" on a membership fails** (/members)
   - Cause (confirmed): `start_membership_now` writes to `audit_logs.old_values`/`new_values`, but the columns are `old_data`/`new_data`.
   - Fix: new migration that recreates `start_membership_now` with the right column names. Nothing else in the function changes.

2. **Nightly renewal detection fails** (automation, 5 times)
   - Cause (likely): `detect_renewal_cases` upserts several rows for the same member in one statement (e.g. two active memberships), and Postgres refuses to update the same case twice.
   - Fix: first read the live function body, then pick one membership per member (latest end date) before the upsert. This keeps the "one open case per member" rule.

3. **Renewal Center funnel chart fails** (9 times)
   - Cause (confirmed): the screen calls `renewal_funnel(_branch_id, _days)`, but that function no longer exists in the database.
   - Fix: find the caller, then either restore a branch-guarded `renewal_funnel` that returns the same shape (counts per renewal stage), or point the screen at the existing summary it should use. Prefer whichever already exists. Errors are still logged.

4. **Body scan 3D model load flagged** (/my-clients, warning)
   - Cause (confirmed): the new security policy lists the scanner domain but not its storage host `howbody-haidiobj.s3.eu-central-1.amazonaws.com`.
   - Fix: add that host to the allowed connect/img/media sources in the policy, and extend the policy test.

After the fixes, mark these four error groups as resolved in System Health.

## Part B — Better "Group AI Fix Prompt"

Today the prompt only lists error messages. It will add, for each cluster:
- **Error type and hint**: missing function, unknown column, ON CONFLICT, CSP origin, permission, timeout, each mapped to a short guide like "compare the RPC arguments with the live signature".
- **Files to audit**: derived automatically from the error. It uses the RPC name from the stack URL (`/rpc/<fn>`, so search `src` for `.rpc('<fn>'` and `supabase/migrations`), the page route, the worker/rule key, the edge function name, and the CSP config/test for CSP warnings.
- **Database objects to check**: the function/table/column named in the message.
- **Shared-cause hint**: when two clusters mention the same function or table.
- **Project rules footer**: concise, with `log_error_event`, `SECURITY DEFINER` + `search_path`, the `rpc_guard_applies` branch check, a "new migration, never edit old ones" note, and "verify with a query before claiming a fix".
- **Required answer format**: Root cause (confirmed vs suspected), Files, Minimal fix, How to verify, plus resolving the error group after the fix.

Same drawer and copy button; only the text gets richer.

## Technical details
- Migration for 1–3. Read live `pg_get_functiondef` first; keep grants per AGENTS.md: authenticated for app RPCs, service_role-only for cron-only functions.
- CSP lives in the vite config/hosting header file found in the previous security change; update its test.
- `src/components/system/BulkAIPromptDrawer.tsx`: move prompt building into `src/lib/system/aiFixPrompt.ts` with pure helpers (`classifyError`, `suggestFiles`, `extractDbObjects`), plus a small bun test covering RPC-name extraction and the unknown-column/missing-function classes.
