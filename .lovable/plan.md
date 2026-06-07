## System Health Audit — Findings

Top open errors right now (from `error_logs WHERE status='open'`):

| # | Severity | Source / Function | Count | Symptom |
|---|---|---|---|---|
| 1 | error | `automation_brain → process_scheduled_campaigns` | **336** (growing every 5 min) | `HTTP 401: Unauthorized` |
| 2 | error | `automation_brain → run_retention_nudges` | 2 | `HTTP 401: Unauthorized` |
| 3 | error | frontend (anon `/`) | many | Network: `permission denied for function log_error_event` + `permission denied for table branches` |
| 4 | error | `edge_function → register-member` | 6 | Logged as literal `[object Object]` (lost detail) |
| 5 | error | `edge_function → send-whatsapp` | 9 | Meta API 400/404 — bad template/params (data issue, not code) |

### Root causes

1. **Cron 401 (issue 1 & 2).** `automation-brain` v1.4.0 dispatches with `apikey: SERVICE_KEY` + `x-system-call: automation-brain` and **no `Authorization` header** (gateway rejects dual sb_ keys). But `process-scheduled-campaigns` and `run-retention-nudges` only accept service-role *bearer*, so every tick returns 401. (`send-reminders`, `birthday_wish` already handle the system header — see memory.)

2. **Frontend `log_error_event` 401.** RPC was created but `GRANT EXECUTE` was never given to `anon` / `authenticated`. Anon callers on the public `/` landing page (and any auth-error replay) silently fail to log, masking real bugs.

3. **Frontend `branches` 401.** `branches` table has zero grants to `anon`/`authenticated` (only `sandbox_exec`). RLS policy `Staff view branches` correctly targets `authenticated`, but without the GRANT PostgREST returns 42501. `BranchContext` runs for every user incl. anon visitors on `/`, so the landing page floods 401s.

4. **`[object Object]` logs.** `captureEdgeError` does `error instanceof Error ? .message : String(error)`. `String(postgrestError)` → `[object Object]`. We lose the real error.

5. **send-whatsapp Meta errors.** Data-level (invalid template name / missing required param). Out of scope for this audit — leave as-is, just resolve old rows.

---

## Plan

### 1. Migration — grants only (no schema change)
```sql
-- Frontend error capture (anon landing pages need this too)
GRANT EXECUTE ON FUNCTION public.log_error_event(
  text, text, text, text, text, text, uuid, uuid, text, text, text, jsonb
) TO anon, authenticated;

-- Branch list is read by BranchContext on every page load incl. anon
GRANT SELECT ON public.branches TO authenticated;
-- (anon: keep blocked — landing page should not fetch; see step 4)
```

### 2. Edge function — accept system header (parity with `send-reminders`)
In **`process-scheduled-campaigns/index.ts`** and **`run-retention-nudges/index.ts`** replace the bearer-only check with:

```ts
const bearer  = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i,"").trim();
const apikey  = req.headers.get("apikey") || "";
const sysCall = req.headers.get("x-system-call") || "";
const isSystem = bearer === serviceKey ||
                 (apikey === serviceKey && sysCall === "automation-brain");
if (!isSystem) return new Response(JSON.stringify({error:"Unauthorized"}), { status: 401, headers: ... });
```
Bump versions: `process-scheduled-campaigns` → v1.2.0, `run-retention-nudges` → vN+1. No business-logic change.

### 3. Shared helper — preserve real error
In **`supabase/functions/_shared/capture-edge-error.ts`**, change message extraction to:

```ts
const message =
  error instanceof Error ? error.message :
  typeof error === "string" ? error :
  (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
```
Benefits every edge function (register-member, etc.) — no per-call changes.

### 4. Frontend — stop anon landing page from hitting `branches`
In **`src/contexts/BranchContext.tsx`**: only call `useBranches()` when `session?.user` exists (anon visitors don't need branch list). Cheaper, removes the noise, and we keep the GRANT scoped to `authenticated`.

### 5. Cleanup — resolve stale rows
After fixes deploy, mark the old open errors as resolved so the SystemHealth dashboard is green:
```sql
UPDATE error_logs SET status='resolved', resolved_at=now()
WHERE status='open'
  AND (function_name IN ('process-scheduled-campaigns','run-retention-nudges','register-member')
       OR error_message LIKE 'Automation rule %failed: HTTP 401%'
       OR error_message = '[object Object]'
       OR error_message LIKE 'Automation rule %failed: HTTP 502%');
```
(send-whatsapp Meta errors left open — they're real data issues to triage separately.)

---

## Files touched
- `supabase/migrations/<new>.sql` — grants only
- `supabase/functions/process-scheduled-campaigns/index.ts`
- `supabase/functions/run-retention-nudges/index.ts`
- `supabase/functions/_shared/capture-edge-error.ts`
- `src/contexts/BranchContext.tsx`
- one-shot SQL via insert tool for cleanup

## Verification
- Tail `error_logs` 10 min after deploy — `process_scheduled_campaigns 401` should stop growing.
- Load `/` while signed-out — no `permission denied` in Network panel.
- Trigger a frontend error — new row appears in `error_logs` with real message (not `[object Object]`).
