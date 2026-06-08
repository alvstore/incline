# AI Brain / Memory / Knowledge — Audit & Hardening Plan

## Audit findings (what's actually wrong today)

**Knowledge base (RAG)**
- `ai_knowledge` has only **8 manual rows** (all global, none branch-scoped). Memory note says "Catalog→brain sync TODO" — plans, PT packages, facilities, trainers, hours, FAQs are **not** in the brain. RAG retrieves at threshold 0.75 but there's nothing rich to retrieve.
- No automatic refresh when catalogs (plans, PT, branches, hours, classes) change.

**AI Brain (`_shared/ai-agent-brain.ts`, 1852 LOC)**
- Two parallel AI entry paths: `generateOnce` (SSOT in `ai-runtime.ts`) vs direct `callAI` (used by brain). Duplicate call-log writes, drift risk.
- Tool follow-up call has **no retry / no jitter** on transient gateway failures (429/5xx); falls straight to deterministic fallback (better than silence but a lost real reply).
- `ai_purposes.whatsapp_reply` row has `provider_id=NULL` and `model=NULL` — purpose config is effectively unused for the most critical surface.
- Onboarding prompt is rebuilt inline every turn (~1.5KB); duplicated logic between webhook prompt and `ai-prompt.ts`.

**Memory (`ai_memory`)**
- Hydrated + patched correctly, but `summary` is rarely written → after ~20 turns, history trimming drops early context.
- No TTL / compaction job.

**Send path** — already hardened in v6.3.0 (error_logs on every silent return). ✅

**Lead-loss observability**
- No SLO monitor. We only see failures when a human notices. Need a cron that flags `inbound_without_reply_within_5m`.

**Tech check (web)** — current best practice for LLM agent reliability is: structured retries w/ jittered backoff, semantic-cache + fact-grounded RAG, periodic memory summarization, and a DLQ for unrecoverable turns (LangGraph / AI SDK patterns). Implement minimally without adding new frameworks.

---

## Plan (6 focused changes, no new frameworks)

### 1. Single SSOT for AI calls
- Migrate the brain's two `callAI` sites in `ai-agent-brain.ts` (primary + tool-follow-up) to call `generateOnce({ purpose: "whatsapp_reply", … })` from `ai-runtime.ts`.
- Drop the manual `ai_call_logs` insert in brain — `generateOnce` already logs.
- Wire `ai_purposes.whatsapp_reply` with explicit `provider_id` + `model` (default `google/gemini-3-flash-preview`).

### 2. Retry with jittered backoff on gateway failures
- Inside `generateOnce` (so all 13 callers benefit): on `429`, `5xx`, network errors → 2 retries with 250ms + 750ms jittered backoff before throwing.
- On final failure, log `error_logs` (severity=error, source=`ai_gateway`) with purpose + branch + contact.

### 3. Knowledge-base catalog sync
- New cron-driven edge fn `sync-ai-knowledge` (runs hourly + on-demand) that upserts `ai_knowledge` rows with `source='catalog'` from:
  - `membership_plans` (active, founder phase ⇒ duration + benefits only, no prices)
  - `pt_packages` (names only, no prices/sessions during founder phase)
  - `branches` (name, address, hours, contact)
  - `classes` (name, schedule overview)
  - `facilities` (name, hours, capacity)
  - `system_events`/FAQ from `src/lib/templates/systemEvents.ts`
- Uses stable `source_ref` (e.g. `plan:<id>`) for idempotent upsert; existing trigger embeds.
- Respects Founder's Phase sanitizer rules (no ₹, no PT session counts).

### 4. Memory summarization
- After every 10 turns OR when history > 4KB, brain calls `generateOnce({ purpose:"context_extract", … })` to produce a 3-sentence `summary` and writes to `ai_memory.summary`.
- Brain prepends summary to system prompt instead of full early history → context never lost.

### 5. Lead-loss SLO monitor
- New cron edge fn `monitor-ai-lead-loss` (every 5 min, dispatched by `automation-brain`):
  - Finds `whatsapp_messages.direction='inbound'` in last 30 min with no outbound reply within 5 min AND `whatsapp_chat_settings.bot_active=true`.
  - Writes `error_logs` (severity=`warning`, source=`ai_lead_loss`) per affected contact (dedup by fingerprint = phone).
  - Triggers retry: re-invokes `triggerAiAutoReply` once with original message_id.
- New SystemHealth tile: "AI reply SLA — last 24h" using this signal.

### 6. Code cleanup (no behavior change)
- Delete the inline onboarding prompt block from brain; move into `ai-prompt.ts` (already the SSOT per memory).
- Remove the manual log insert (step 1).
- Mark legacy comments referencing the deleted 800-line webhook brain (already gone) as resolved.

---

## Technical details

| File | Change |
|---|---|
| `supabase/functions/_shared/ai-runtime.ts` | Add `retryOnTransient` (default true), jittered 2-retry; log final failure to `error_logs`. |
| `supabase/functions/_shared/ai-agent-brain.ts` | Replace 2× `callAI` with `generateOnce`; drop manual `ai_call_logs` insert; extract onboarding prompt to `ai-prompt.ts`; add 10-turn summarization hook. |
| `supabase/functions/_shared/ai-prompt.ts` | Add `buildOnboardingPrompt(memory, ctx)` returning the WA founder-phase block. |
| `supabase/functions/sync-ai-knowledge/index.ts` | **NEW.** Catalog → `ai_knowledge` upsert with `source='catalog'`. |
| `supabase/functions/monitor-ai-lead-loss/index.ts` | **NEW.** SLO cron + auto-retry. |
| Migration | Seed `ai_purposes.whatsapp_reply` with `provider_id`, `model='google/gemini-3-flash-preview'`. Register both crons in `automation_rules`. |
| `src/pages/Settings.tsx` (SystemHealth) | Add "AI Reply SLA (24h)" tile reading `error_logs` source=`ai_lead_loss`. |

## Verification
- Replay Ravindra + Gaurav last inbound → confirm outbound row created within 10s, `ai_call_logs` shows single (not duplicate) row, no `error_logs.warning`.
- Manually drop one network packet via `provider_id='invalid'` → confirm 2 retries, fallback to default provider, single `error_logs` entry.
- After 11 turns in a test thread → confirm `ai_memory.summary` populated.
- Run `sync-ai-knowledge` once → confirm ~30+ `source='catalog'` rows with embeddings.
- Pause bot + send inbound → `monitor-ai-lead-loss` does NOT alert (bot disabled). Re-enable → alert fires + retry succeeds.

## Out of scope
- WhatsApp send-lock RPC (v6.2.0 correct).
- Founder-phase sanitizer (correct).
- Frontend redesign of Settings → AI Agent (separate request).
