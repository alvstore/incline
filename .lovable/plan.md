## Problem

When the AI's non-fitness intent guard fires (careers / vendor / press / partnership), it sends the `info@theinclinelife.com` redirect — but:

1. **Duplicate replies** — every subsequent inbound message re-runs the guard and re-sends the same canned reply (visible in your screenshot).
2. **Nurture keeps running** — WhatsApp/IG/FB lead-nurture and retention cron jobs continue pinging the contact because `do_not_contact` and `bot_active` are never set.
3. **Hardcoded context** — the regex + redirect copy live inline in `ai-agent-brain.ts` instead of `ai_purposes.guards`, so tweaking it needs a deploy.

## Fix (audit + backfill, no inline hardcoding)

### 1. `supabase/functions/_shared/ai-agent-brain.ts` — non-fitness guard block (lines ~159-169)

After detecting a non-fitness intent, in this order:

- **Dedupe**: query last outbound message on this `(branch_id, phone_number, platform)` within last 24h. If its content equals the redirect text, return `skip("non_fitness_already_redirected")` — no second send, no re-pause.
- **Send the redirect once** (existing behaviour).
- **Pause nurture atomically**:
  - `supabase.rpc('mark_do_not_contact', { p_phone: ctx.senderId, p_branch_id: ctx.branchId, p_reason: 'non_fitness_inquiry', p_source: 'ai_guard' })` — flips `do_not_contact=true` across `whatsapp_chat_settings`, `leads`, `members`. This is what the nurture/retention crons already honor (`lead-nurture-followup` line 60-77, `run-retention-nudges` line 61-67), so no worker changes needed.
  - Update `whatsapp_chat_settings` for this contact: `bot_active=false`, `paused_at=now()`, `pause_reason='non_fitness_inquiry'` — mirrors the pattern used at lines 1197/1216/1248 when a lead is captured.
- Wrap both in try/catch + console.warn so a failed pause never breaks the reply.

### 2. Move guard data into `ai_purposes.guards` (backfill in context, not code)

Migration to `UPDATE public.ai_purposes` and seed the `guards` JSONB with:

```json
{
  "non_fitness_redirect": true,
  "non_fitness_message": "Thanks for reaching out! For careers, partnerships, vendor, media, or other non-membership inquiries please email *info@theinclinelife.com* or call our front desk. This channel is for membership and fitness queries only. 🙏",
  "non_fitness_pattern": "\\b(job|jobs|vacancy|...|tie[-\\s]?up)\\b",
  "non_fitness_pause_nurture": true,
  "non_fitness_dedupe_window_hours": 24
}
```

Code reads `purposeRow.guards.non_fitness_pattern` (fall back to current hardcoded regex if absent) and `non_fitness_pause_nurture` / `non_fitness_dedupe_window_hours`. So future tweaks are a DB row, not a deploy. Bump file header to `v3.6.0`.

### 3. Memory write

After pausing, also push `do_not_ask_add: ['fitness_goal','plan_interest']` + `current_intent: 'non_fitness'` into `ai_memory` via `upsertMemory`, so even if the contact is un-paused later we don't restart the onboarding script mid-thread.

## Out of scope

- No change to nurture cron workers — they already honor `do_not_contact` and `bot_active`.
- No change to the redirect text content or who it routes to.
- No change to Meta-webhook / `send-meta-dm` / `send-message` / WhatsApp webhook — guard fires inside the shared AI brain that all three call.
- No new tables, no RLS changes.

## Verification

1. New inbound containing "job/vendor/press" → one redirect sent, `whatsapp_chat_settings.do_not_contact=true`, `bot_active=false`.
2. Same contact sends another off-topic message → guard short-circuits at dedupe check, zero outbound.
3. `lead-nurture-followup` next tick → contact filtered out by existing `do_not_contact=false` predicate.
4. Edit `ai_purposes.guards.non_fitness_message` in DB → next reply uses the new copy with no redeploy.
