## Audit findings (from error_logs + whatsapp_messages)

Three live conversations stalled today with the same fingerprint:

| Lead | Last inbound | Last outbound | What error_logs shows |
|------|--------------|---------------|------------------------|
| Pallavi Joshi (+91 88548 69672) | "Weight loss and body maintained" 10:26 | none after | `sendAiReply skipped: send-lock held` + `No AI reply within 5m` |
| Pradil Talwar (+91 97999 84546) | "Pradil Talwar" 12:33 | none after | same pair |
| ravindra (+91 80055 43139) | "??" 13:35 | none after | same pair |

**Critical observation:** for the *first* invocation (the one that won the send-lock) there is **no** "AI reply skipped" log, **no** "AI reply pipeline crashed" log, and **no** "sendAiReply crashed" log — and no outbound row in `whatsapp_messages`. The function simply vanished. The only artifact is the *second* Meta-retried invocation hitting the held lock and being correctly suppressed.

Root cause is therefore one of:
1. `runUnifiedAgent` (LLM) exceeded the edge-function worker budget and the runtime killed the worker before any catch/log could fire. The `shutdown` events in edge logs confirm workers do get reaped.
2. Send-lock TTL is **8 s** but Gemini calls regularly take 10–30 s, so the first invocation's lock has already expired by the time the retry arrives — yet we still see the retry blocked, meaning the first call IS still running when it dies.
3. Lead-nurture cron correctly skips these contacts because `last_message.direction='inbound'` (line 139 of `lead-nurture-followup`) — by design nurture is only for stale outbound. So when the brain silently dies on an inbound, **no system ever recovers the thread**. `monitor-ai-lead-loss` only writes a warning; the "Active Recovery" upgrade described in the last summary is not actually firing for any of these three threads.

## Plan

### 1. Make brain failures impossible to hide — heartbeat trace
File: `supabase/functions/whatsapp-webhook/index.ts` + `supabase/functions/_shared/ai-agent-brain.ts`

- Insert a `system_health_pings` row (`source='whatsapp_brain', stage='start', ref=<inbound_message_id>`) immediately before `runUnifiedAgent`.
- On clean return write `stage='end'`; on catch write `stage='error'` with the message.
- Any `start` row without a matching `end`/`error` after 90 s → conclusive proof of a worker kill, surfaced in System Health.

### 2. Lengthen + correctly scope the send-lock
File: `supabase/functions/whatsapp-webhook/index.ts` (~ line 732)

- Bump TTL `_ttl_seconds: 8` → `60`. Matches realistic LLM + Meta-send budget.
- Keep the `cleanPhone:inboundMessageId` key so legitimate back-to-back inbounds still get answered.

### 3. Active recovery actually runs
File: `supabase/functions/monitor-ai-lead-loss/index.ts`

- Verify deployment + cron registration (the last summary claimed this but no recovery was emitted for the three stalled threads).
- When an inbound has had no outbound for ≥ 3 min AND `bot_active=true` AND no human handoff:
  - Re-invoke `runUnifiedAgent` (not `triggerAiAutoReply`) with the original `messageId` and an idempotent lock `ai_recover:<message_id>`.
  - If the brain still returns nothing, fall back to a deterministic safe reply pulled from `ai_memory.partial_lead_data` (ask for the next missing onboarding field: name → email → goal → plan duration).

### 4. Deterministic next-step short-circuit also covers the "only name captured" state
File: `supabase/functions/_shared/ai-agent-brain.ts`

The existing short-circuit only fires when name + email + goals are all captured. Extend it to fire after **each** captured field, so a free-text "Pradil Talwar" reply ALWAYS produces the email prompt without any LLM call. This removes the whole class of "LLM stalls on a captured-name turn" failures (which is exactly what hit Pradil).

### 5. Surface stalled conversations in System Health
File: `src/pages/SystemHealth.tsx` (new card `StalledConversationsCard.tsx`)

- Query: inbound WhatsApp messages in last 24 h with no outbound from the same `phone_number` within 5 min of the inbound, grouped by phone.
- Show: contact name, phone, last inbound text, minutes stalled, branch.
- Actions: **Retry AI** (calls `monitor-ai-lead-loss` for that single phone), **Take Over** (sets `bot_active=false` and opens the WhatsApp inbox thread).

### 6. Nurture safety net for stalled inbound threads
File: `supabase/functions/lead-nurture-followup/index.ts`

Currently skips when `lastMsg.direction === 'inbound'`. Add a SECOND branch: if the inbound is older than 30 min AND no outbound has been produced AND no human handoff exists, send the deterministic "next-step" template (same source as recovery) so the lead is never left hanging — even if every other layer fails.

## Files to change

- `supabase/functions/whatsapp-webhook/index.ts` — heartbeat + lock TTL
- `supabase/functions/_shared/ai-agent-brain.ts` — per-field short-circuit + heartbeat hook
- `supabase/functions/monitor-ai-lead-loss/index.ts` — guarantee active recovery + verify cron
- `supabase/functions/lead-nurture-followup/index.ts` — stalled-inbound branch
- `src/pages/SystemHealth.tsx` + new `src/components/system/StalledConversationsCard.tsx`

## Verification after build

1. Insert a synthetic inbound for `+918005543139` and confirm: heartbeat start row, outbound row, heartbeat end row all appear within 60 s.
2. Confirm `automation_runs` shows `monitor-ai-lead-loss` actually emitting `recovery_sent` for the three currently-stalled phones.
3. SystemHealth `/system-health` shows zero "stalled" cards after the recovery cycle.

Used the engineering-skills + senior-architect skills.
