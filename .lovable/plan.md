# Audit: Ankit Sisodia (+91 99822 06401) WhatsApp chat

## What actually happened (from DB)

Timeline from `whatsapp_messages` (only one row per send — these are NOT UI duplicates, the bot really sent each one):

| time | dir | content |
|---|---|---|
| 23:33:07 | in  | Hey |
| 23:33:14 | in  | Where r u located |
| 23:33:16 | out | Hi! I'm Ananya … name? |
| 23:33:26 | out | Hi! I'm Ananya … name?  ← duplicate-feeling |
| 23:33:33 | in  | Ankit |
| 23:33:41 | out | Thanks, Ankit — what's the best email? |
| 23:34:08 | in  | Ankit3093@gmail.com |
| 23:34:17 | out | Thanks, Ankit — what's the best email?  ← re-ask |
| 23:34:40 | in  | Ankit3093@gmail.com |
| 23:34:52 | out | Thanks, Ankit — what's the best email?  ← re-ask |

`ai_memory` for this contact: `profile = { first_name: "Ankit" }` — **email was never persisted**. `leads` row was only created the next day at 13:48 UTC by a separate path with a different email (`ankit@aashatours.com`), not by the chat.

## Root causes

1. **Email is stripped from memory updates.** `supabase/functions/_shared/ai-agent-brain.ts` line ~1995 runs `delete parsed.profile.email` on the LLM enrichment output ("comes from auth/webhook"). For an AI-only WhatsApp lead there is no auth/webhook source, so `memory.profile.email` stays empty forever.
2. **No deterministic inbound extraction.** The fallback lead-capture path (~line 1650) regex-matches against the *bot's reply text*, not the user's last inbound message, so `Ankit3093@gmail.com` is never picked up.
3. **Onboarding short-circuit re-asks** the next-missing field on every turn. Because `memory.profile.email` is forever empty, "what's the best email?" is sent on every reply.
4. **No burst coalescing.** Send-lock key is `phone:inboundMessageId`, which is unique per inbound. Two inbounds 7 s apart each fire an independent brain run and reply — feels like duplicates to the user.

## Fix plan (frontend = none; all backend in ai-agent-brain + webhook)

### 1. Persist email/name from the user's inbound message (deterministic)
In `supabase/functions/_shared/ai-agent-brain.ts`, in the memory-delta builder (around the LLM enrichment block, ~1962–2010):
- Before the LLM call, run regex on `lastUser`:
  - email: `/[\w.+-]+@[\w-]+\.[\w.]+/i`
  - first-name when state is "asked name" and inbound is 1–3 word alpha tokens (looksLikeRealName guard already exists).
- Merge into `delta.profile` (`email`, optionally `full_name`/`first_name`) so memory is updated even if the LLM call returns nothing.
- Remove the unconditional `delete parsed.profile.email` strip; keep the strip only when an authoritative lead row already has a different email on file (compare against `leadCtx.profile.email`).

### 2. Upsert the captured email into the lead row immediately
After (1) sets `delta.profile.email`, write through to `leads`:
- If `leadCtx.id` exists → `update leads set email = coalesce(email, $email), full_name = coalesce(full_name, $name) where id = leadCtx.id`.
- If no lead yet AND we now have name + email → call the existing lead-create path with `{ name, email, phone, source: whatsapp_ai, branch_id }` directly (do not wait for the LLM to emit a `lead_captured` JSON envelope).

This makes onboarding state advance on the *next* turn — the deterministic "ask email" short-circuit will no longer trigger.

### 3. Coalesce inbound bursts to one reply
In `supabase/functions/whatsapp-webhook/index.ts` (`sendAiReply`, just before the send-lock acquisition at ~line 749):
- Query `whatsapp_messages` for any `direction='outbound'` row with `created_at > now() - interval '8 seconds'` matching `phone_number = cleanPhone`.
- If one exists AND the inbound that triggered this run arrived before that outbound's `created_at`, log `coalesced` and return (no second reply).
- Keep the existing per-`inboundMessageId` lock for true webhook retries.

This stops the "two ‘Hi I'm Ananya' messages 10 s apart" pattern when a user fires two messages in quick succession.

### 4. Throttle the deterministic onboarding ask
In the short-circuit that emits "Thanks, X — what's the best email?" (~ai-agent-brain.ts 576–581), check the last 2 outbound messages for the same prompt within 60 s. If duplicate, skip sending (return null/no-op) instead of re-asking. Belt-and-braces in case (1)+(2) miss.

### 5. Backfill this lead's email (one-off SQL, no migration)
Optional and only with user OK: update `leads.be59a311-…` so `email = 'Ankit3093@gmail.com'` (the value the contact actually typed) instead of the unrelated `ankit@aashatours.com`. Out of scope unless confirmed.

## Files touched
- `supabase/functions/_shared/ai-agent-brain.ts` — items 1, 2, 4
- `supabase/functions/whatsapp-webhook/index.ts` — item 3
- `mem://integrations/whatsapp-transactional-ai-agent` — note the new "deterministic inbound extraction + 8 s burst coalesce" rules

## Out of scope
- Refactor of `tryCaptureLeadFromAi` (only minimal change to source partialData from inbound).
- UI changes in WhatsAppChat — no frontend code touched.
- IG/Messenger paths — same fixes apply structurally but are not the reported defect; will be covered because the changes are in shared brain code.
