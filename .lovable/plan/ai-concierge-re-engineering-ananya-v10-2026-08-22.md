# AI Concierge Re-Engineering — Ananya v10

## Phase 1 — Diagnostic (already completed, findings below)

I read `_shared/ai-agent-brain.ts` (3,045 lines), `_shared/ai-prompt.ts`, `meta-webhook/index.ts` and queried the live schema. Confirmed findings:

1. **The deadlock is real and deterministic, not an LLM problem.** In `ai-agent-brain.ts` (~line 1208), a block runs *before* any LLM call: when lead capture is on and no name is on file, it returns a canned name-ask and never reaches the model. A second copy of the same ladder exists as a post-LLM rewriter (`askNextMissing`, ~line 1791) which overwrites a perfectly good LLM reply with `"Sure — may I have your name first? ✨"`. Two independent gates, same string — this is the loop.
2. **Name persistence is over-gated.** Inbound name capture (~line 2839) only runs when the *previous bot message* matched a narrow name-prompt regex, and only when the reply is 1–3 alpha tokens. "Mera naam Rahul hai", "Ritesh here", or a name given unprompted are all dropped. `looksLikeRealName` additionally rejects anything the dynamic-intent classifier matches, so short Indian names can be silently discarded.
3. **Write failures are swallowed but the funnel still stalls.** Memory/lead writes are wrapped in try/catch (good), but because the deterministic ladder reads only `memory`, a failed `upsertMemory` means the next turn re-asks the same field forever. There is a loop-breaker (`detectRepeatedAskLoop`) but it only fires after 2+ identical asks and then goes *silent*, which is what users experience as a dead bot.
4. **Schema note (corrects the brief):** there is no `ai_paused` column and no `ai_messages`/`chat_history`/`conversations` table. The existing equivalents are `whatsapp_chat_settings.bot_active` (per-contact pause, plus `handoff_reason`, `paused_at`) and `whatsapp_messages` (unified WhatsApp/IG/Messenger history). `leads` already has `full_name`, `phone`, `status`, `source`, `notes`, `bot_active`, `do_not_contact`, `updated_at`. **No new tables will be created** — reusing these avoids a second source of truth.

## Phase 2 — Context RPC (no new tables)

Add one migration creating `public.get_or_create_chat_context(p_sender text, p_branch uuid, p_platform text)` returning a single JSON payload:
- member record when the sender matches a member (via `profiles.phone` / member identity resolver), else the lead row (created if absent),
- `is_member` boolean, `bot_active`, `handoff_reason`,
- last 10 turns from `whatsapp_messages`,
- the `ai_memory` snapshot.

`SECURITY DEFINER`, `search_path` pinned, `GRANT EXECUTE` to `service_role` only (edge-function use). This collapses today's 5 sequential round-trips into 1, which also buys back webhook latency.

## Phase 3 — Brain pipeline rebuild

In `ai-agent-brain.ts`:
- **Delete both deterministic ask-ladders** (the pre-LLM short-circuit and the `askNextMissing` post-LLM rewriter). Every inbound message flows: context resolve → prompt build → LLM → light safety sanitizers. The only hard bypass is `bot_active === false` (paused / human handoff) and existing do-not-contact / solicitation guards.
- **Structured extraction on every turn.** Replace the regex name gate with a tool/structured-output pass that returns `{ name, email, goal, plan_interest, intent, sentiment, wants_human }` from the raw message regardless of what the bot asked previously. Persist to `ai_memory` + `leads` fire-and-forget; the acknowledgement is produced in the same LLM turn, so a slow write never blocks the reply.
- **Keep only these outbound guards:** pricing/embargo sanitizer, hallucinated-action stripper, social-handle/Maps correction, and a new consecutive-duplicate-sentence blocker (rephrase instead of going silent).
- **Prompt rules** injected via `ai-prompt.ts` `<strict_rules>` and matching `ai_knowledge` rows: Ananya identity (Incline — Rise.Reflect.Repeat., Udaipur; English/Hindi/Hinglish), anti-repetition, frustration/slang resilience with warmth and humour, pricing blackout (plans are customised, discussed on a VIP tour or at the front desk), and the facility authority list (100% AC with aroma diffusers and no ceiling fans, QSC audio, 15 KVA steam, separate male/female recovery suites, cold plunge, full-spectrum carbon sauna, 7-wavelength red light therapy, 70+ strength machines, Olympic-grade cardio floor, Pilates/Yoga room).

## Phase 4 — Member self-service & handoff

- When `is_member`, skip the sales funnel entirely and expose the existing tools from `_shared/ai-tools.ts`: PT balance, facility timings/peak hours, benefit credits, dues, and trainer/front-desk connection.
- Handoff on explicit request ("talk to human", "manager number", "call me") or high frustration: set `whatsapp_chat_settings.bot_active = false` with `handoff_reason`, create a front-desk task via the existing `tasks` + `create_system_notification` path (not a new table), and reply with the confirmation line.

## Phase 5 — Verification

- Move all post-reply work (memory writes, lead backfill, notifications) off the response path so the webhook ack stays well under 3s; the webhook already acks early — I will confirm no awaited AI work remains before the 200.
- Add `supabase/functions/_shared/__tests__/ai-agent-brain.test.ts` (Deno test, mocked LLM + Supabase) covering: A "Kya haal?" → warm Hinglish greeting, no name gate; B "John" → name persisted and acknowledged; C "WTF your bot is useless" → graceful apology, no name re-ask; D "fees kitni hai?" → blackout + VIP tour offer.

## Technical notes

- Files touched: `_shared/ai-agent-brain.ts` (major), `_shared/ai-prompt.ts`, `_shared/ai-tools.ts` (member self-service wiring), one new migration, one new test file. `meta-webhook` and `whatsapp-webhook` change only if they await brain work before responding.
- Behaviour change to flag: removing the deterministic ladder means the funnel (name → email → goal → plan) becomes LLM-driven guidance rather than a hard gate. Lead rows still get created and backfilled; some conversations will collect fields in a different order or not at all if the user never volunteers them.
- No pricing text is added anywhere; the blackout rule is strengthened.
