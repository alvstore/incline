# Marketing Broadcast — Root-Cause Audit & Fix

## What the data proves

Live DB snapshot (both `sending` campaigns are stalled):

| Campaign | recipients | pending | sent | failed | last progress |
|---|---|---|---|---|---|
| `Construction Walkthrough Reel V1` (8a0ea1de…) | 345 | **345** | 0 | 0 | 7h+ ago |
| `CHOOSE_WHAT_DESERVES` (264bd41f…) | 325 | 20 | 30 | **275** | 24h+ ago |

**All 275 failures share one error string:** `"Failed to send a request to the Edge Function"`.

Edge log for the new campaign:
```
[chunk] campaign not found 8a0ea1de-d807-4e90-9c9d-09a7b4798f61
```
…even though the row obviously exists.

Both symptoms point to the **same defect**: `send-broadcast` uses `adminClient.functions.invoke(...)` for BOTH
1. self-invoking `mode='chunk'` (the "campaign not found" trace is actually the *invoke* failing so the chunk never runs — the log line is misleading because `data:null, error:null` is treated as "not found"), and
2. calling `dispatch-communication` per recipient.

The Supabase JS client's `functions.invoke` inside the Deno edge runtime is unreliable — it uses `fetch` against the internal edge URL, hits keep-alive / DNS / body-stream issues, and returns the generic `"Failed to send a request to the Edge Function"` for anything non-2xx or aborted. This is the reason marketing broadcasts using the MM API keep dying — the MM API itself is fine; **we never reach Meta**.

Nothing about MM API is broken — the request just never leaves our stack. That is why "how does everyone else send bulk?" — they do exactly what this plan proposes below (raw fetch between workers, tier-aware pacing, resumable chunks).

---

## The fix (5 targeted changes, no new edge functions)

### 1. Replace every from-edge `functions.invoke` with raw `fetch`
In `supabase/functions/send-broadcast/index.ts`:
- Add a `invokeEdge(fnName, body)` helper that POSTs to `${SUPABASE_URL}/functions/v1/${fnName}` with `Authorization: Bearer ${SERVICE_ROLE}`, `apikey: ${SERVICE_ROLE}`, `x-system-call` header, 25s AbortController timeout, and returns `{ ok, status, data, error }`.
- Rewrite:
  - `kickChunk()` → `invokeEdge('send-broadcast', { mode:'chunk', campaign_id })` (fire-and-forget via `EdgeRuntime.waitUntil`).
  - The per-recipient `dispatch-communication` call in `handleChunk` → `invokeEdge('dispatch-communication', {...})`.
  - The fallback RCS dispatch → same helper.
- Same for `process-scheduled-campaigns/index.ts` when it kicks the materialize/chunk cycle.

### 2. Stop swallowing the real error on the campaign lookup
`handleChunk` currently does `const { data: campaign } = await ... .single()` and treats `!campaign` as "not found". Change to destructure `error`, log the full PostgREST error, and — critically — do NOT return early on a transient error. On error, requeue (`EdgeRuntime.waitUntil(setTimeout(kickChunk, 5000))`) and exit. Only exit if `error.code === 'PGRST116'` (0 rows).

### 3. Meta-aware pacing (this is what other platforms do)
WhatsApp Cloud/MM API for a new BSP number sits in tier 250 (250 unique users/24h) until Meta auto-upgrades to 1K → 10K → 100K → unlimited. Error `131049` is Meta's "quality/pacing" throttle — nothing about the message is wrong, it's a *rate* problem. Solution:
- Add a small in-memory token bucket per chunk: `batch_size=15`, `pacing_ms=2500` (≈24 msg/min ≈ 1440/hr — safe for tier 1K, still finishes 345 in ~15 min).
- Add per-chunk exponential back-off on `131049`/`130472`: on first hit, cut `batch_size` in half AND raise `pacing_ms` by 1.5×; persist those two numbers into `campaigns.fallback_policy.pacing_state` so the next chunk picks up the adjusted rate.
- On sustained `131049` (>50% of a chunk), stop chunking for 15 minutes: set `campaigns.status='sending'` + `last_progress_at = now() + interval '15 minutes'` (the watchdog already resumes stalled campaigns).
- Never mark the campaign as `failed` for pacing errors — only for terminal template-config errors (`132xxx`).

### 4. Reset the two stuck campaigns
One-shot SQL migration in the same push:
- Reset `campaign_recipients` rows with `status='failed'` AND `error='Failed to send a request to the Edge Function'` back to `status='pending'`, `error=NULL`, `attempt=0`.
- Reset both campaigns' `last_progress_at` to `now() - interval '10 minutes'` so the existing watchdog re-triggers them on the next `automation-brain-tick`.
- Keep counters as-is — the chunk's DB-recount at end of each pass rewrites `success_count/failure_count` from truth.

### 5. UI: expose the real reason on the campaign card
In `CampaignsPanel.tsx`, show the top 3 error strings for the campaign (from `campaign_recipients` grouped by `error`, top failure counts) under the progress bar so the operator can see "247 × paced_131049" vs "275 × Failed to send a request to the Edge Function" at a glance. No layout changes — just a small `<div>` under existing progress meter.

---

## Technical notes

- **Why raw `fetch` and not the SDK from edge?** The SDK's `functions.invoke` inside Deno runtime aborts the body stream on any non-2xx and normalizes every error to `"Failed to send a request to the Edge Function"`. Raw `fetch` with `signal: AbortSignal.timeout(25000)` returns the real status + body so we can classify failures.
- **Why not queue via pg_cron only?** We already do (`automation-brain-tick` runs the watchdog every 5 min). This plan keeps that as the outer resume loop and fixes the *inner* per-recipient loop that was silently dying.
- **Why in-memory + persisted pacing?** In-memory prevents burst within one chunk; persisting to `campaigns.fallback_policy.pacing_state` prevents the *next* chunk (which is a fresh isolate) from repeating the same throttle mistake.
- **MM API remains the primary route** — `dispatch-communication` already sets `use_mm_api:true` for `category:'marketing'`. No route change needed.

## Files touched

- `supabase/functions/send-broadcast/index.ts` (add `invokeEdge`, rewrite `kickChunk` + `handleChunk` dispatch calls, add pacing back-off & persistence)
- `supabase/functions/process-scheduled-campaigns/index.ts` (use `invokeEdge` for materialize/chunk kicks)
- `src/components/campaigns/CampaignsPanel.tsx` (top-3 failure-reason breakdown)
- 1 SQL migration (reset stuck rows + nudge watchdog; no schema change)

## Success criteria

- `Construction Walkthrough Reel V1` finishes with >90% `sent` in <30 min.
- Zero rows with `error='Failed to send a request to the Edge Function'` after the run.
- Any `131049` rows show `pacing_code=131049` and either `fallback_used=true` (RCS) or a retry on the next chunk — never a hard `failed`.
- UI progress card shows real failure taxonomy, not "0/0".
