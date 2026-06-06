
## Audit findings — ravindra (+91 80055 43139) chat

### Timeline (from `ai_call_logs` + `whatsapp_messages`)

| Time (UTC) | Event | Status |
|---|---|---|
| 13:04:54 | inbound "when it will start in udaipir" | received |
| 13:05:01 | context_extract | success |
| 13:05:04 | inbound "udaipur*" | received |
| 13:05:04 | whatsapp_reply LLM call | success |
| 13:05:05 | outbound "Hi there! What's your name?" | **delivered** ✓ (send-lock acquired, expires 13:05:13) |
| 13:05:10 | context_extract | success |
| 13:05:14 | whatsapp_reply LLM call | success — **but NO `whatsapp_messages` row was created** |
| 13:05:16 | inbound "ravindra" | received |
| 13:05:22 | context_extract | success |
| 13:05:26 | whatsapp_reply LLM call success → row inserted with `status='pending'` | **STUCK pending forever** ✗ |

`failure_reason`, `failure_code`, `failed_at`, `sent_at`, `whatsapp_message_id` are all NULL. No `error_logs` entry. No `communication_logs` entry.

### Root cause #1 — Pending-forever bug in `sendAiReply`

In `supabase/functions/whatsapp-webhook/index.ts` (lines 633–712):

1. Line 633: insert outbound row with `status='pending'`.
2. Line 697: `fetch(metaUrl, …)` — un-wrapped network call.
3. Line 706 (on OK) or line 745 (on non-OK): update status.

If the edge-function worker shuts down between the insert and the Meta call — which the function logs show happens every few minutes (`Shutdown` events 30–90 s apart) — the row is committed as `pending` and the `fetch` never completes. **There is no reaper / retry queue for AI auto-reply rows stuck in `pending`.** It sits forever, looks like a successful AI reply in the database, never reaches Meta.

### Root cause #2 — Broken column reference masks duplicate-suppression

Line 671:
```ts
.update({ status: "failed", error_message: "duplicate suppressed" })
```
`whatsapp_messages` has **no `error_message` column** — it has `failure_reason`/`failure_code` (see `\d whatsapp_messages`). PostgREST returns `42703` and the update silently no-ops, leaving the duplicate row also stuck at `pending`. Line 392 has the same bug for inbound rows.

### Root cause #3 — Communication Hub has zero visibility

`sendAiReply` writes directly to `whatsapp_messages` and never calls `dispatchCommunication()`. Communication Hub reads `communication_logs`. Therefore:
- Every AI auto-reply (across hundreds of contacts) is invisible in Communication Hub.
- No dedupe, no quiet-hours, no DNC check applied at the hub layer (only the brain-side gates work).
- Project memory explicitly states "All NEW outbound Email/SMS/WhatsApp/in-app code MUST call `dispatchCommunication()`" — this legacy path was never migrated and the CI guard exempts it.

### Root cause #4 — Missing turn at 13:05:14

The LLM produced a reply (cost was logged in `ai_call_logs`), but no row was inserted. Two possible causes (need to verify after fix #1 lands):
- `sendAiReply` was called and `runUnifiedAgent` returned `skipped=true` due to an internal guard, OR
- the row was inserted in a worker that died before commit. Either way, fix #1 + new observability will surface it.

## Plan — Make AI auto-reply observable, recoverable, and unified

### Step 1 — Fix the silent column bug (P0, 1 line)

In `whatsapp-webhook/index.ts`:
- Line 392: `patch.error_message = errMsg` → `patch.failure_reason = errMsg`
- Line 671: `error_message: "duplicate suppressed"` → `failure_reason: "duplicate suppressed", failed_at: new Date().toISOString()`

Also set `failed_at = new Date().toISOString()` on line 745 (the Meta-non-OK branch) and capture `failure_reason = JSON.stringify(metaData?.error || metaData).slice(0, 500)`, `failure_code = String(metaData?.error?.code ?? '')`.

### Step 2 — Wrap the Meta send in try/finally + mark stuck rows (P0)

Wrap lines 697–746 in `try { … } catch (e) { update status='failed', failure_reason='exception: ' + e.message, failed_at=now() } finally { release send-lock }`. So any cold-shutdown between insert and `await metaResponse.json()` at least logs the failure rather than leaving `pending`.

### Step 3 — Recovery cron: reap stuck AI `pending` rows

New edge function `reconcile-whatsapp-pending`:
- Selects `whatsapp_messages` rows where `direction='outbound' AND status='pending' AND created_at < now() - interval '3 minutes' AND whatsapp_message_id IS NULL` (cap 100 per tick).
- For each row, re-attempts the Meta send via the existing integration credentials (using the same logic as `sendAiReply`). On success → `status='sent', sent_at=now(), whatsapp_message_id=…`. On failure → `status='failed', failure_reason='reconciler: ' + …, failed_at=now()`.
- pg_cron schedule: every 2 minutes. Idempotent (uses the same send-lock RPC).

This guarantees Bhavyadeep-style stuck rows resolve themselves within ~5 min.

### Step 4 — Mirror every AI outbound into `communication_logs`

In `sendAiReply`, on the success branch (after line 712) and on the failure branch (after line 745), insert into `communication_logs`:
```
{
  branch_id, recipient: cleanPhone, type: 'whatsapp', channel: 'whatsapp',
  category: 'ai_auto_reply', status: 'sent'|'failed',
  delivery_status: 'sent'|'failed',
  content: replyText.slice(0, 2000), provider_message_id: whatsapp_message_id,
  error_message: failure_reason ?? null,
  dedupe_key: `ai_reply:${aiMsg.id}`,
  delivery_metadata: { ai_message_id: aiMsg.id, platform: 'whatsapp', meta_response_code: metaResponse.status }
}
```
This is a **mirror write, not a route through `dispatchCommunication`** — the brain has its own gates (DNC, quiet-hours via the brain, 24h template logic), and routing through the dispatcher would require non-trivial refactor. The mirror gives Communication Hub the visibility it needs today.

Document the exemption in the CI guard comment so future devs know `sendAiReply` is the only sanctioned direct-write path.

### Step 5 — Backfill the stuck row

Either:
- Trigger the new reconciler manually for this row, OR
- Set its status to `failed` with `failure_reason='legacy stuck pending — pre-reconciler'` so it no longer pollutes the chat thread UI.

Recommended: let the reconciler retry it once (it's still within Meta's 24h freeform window — last inbound 13:05:16, so freeform allowed until +24h tomorrow).

### Step 6 — Investigate the missing turn at 13:05:14

Add a single `console.log` at the top of `triggerAiAutoReply` and at the start/end of `sendAiReply` capturing `messageId`, `phone`, `result.skipReason`. Then re-run any test inbound from a sandbox number to confirm the brain isn't silently skipping mid-onboarding. Pure observability; no behavioural change.

## Out of scope

- No changes to AI brain logic, persona, lead capture, or memory hydration.
- No refactor of `sendAiReply` to fully route through `dispatchCommunication` — that's a P2 hardening, separate plan.
- No schema changes — all existing columns are reused.

## Files to touch

| File | Change |
|---|---|
| `supabase/functions/whatsapp-webhook/index.ts` | Fix column bug (l.392, l.671), wrap Meta send in try/catch with `failed_at`/`failure_reason`, mirror write to `communication_logs` on both branches, add 3 `console.log` lines for observability |
| `supabase/functions/reconcile-whatsapp-pending/index.ts` | **new** edge fn (~120 lines) — reaper for stuck `pending` outbound rows |
| `supabase/migrations/<ts>_reconcile_whatsapp_pending_cron.sql` | pg_cron `*/2 * * * *` job that POSTs to the new fn with service-role bearer |
| Manual SQL (no migration) | Backfill the one stuck row (`3e5f9bcb…`) — done after Step 3 deploys |

## Validation

1. After Step 1+2, deploy `whatsapp-webhook` and send a test inbound from a Meta sandbox number → confirm any failure now writes `failure_reason` + `failed_at` (not silent `pending`).
2. After Step 3, manually insert a fake `pending` row and confirm the reconciler picks it up within 2 min.
3. After Step 4, open Communication Hub → filter `category=ai_auto_reply` → confirm new AI replies appear with `status='sent'` and `provider_message_id` populated.
4. Re-trigger the brain for ravindra's number with a fresh inbound — confirm the next outbound reaches `status='sent'` and shows in the Hub.
