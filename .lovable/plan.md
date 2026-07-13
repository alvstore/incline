
## Audit of the Vera/magicpin chat (+91 89292 53155)

The bot behaved like a scripted form, not a concierge. Root causes, all in `supabase/functions/_shared/ai-agent-brain.ts`:

1. **No intent classification before lead-capture kicks in.** Any inbound message from an "unknown" contact enters the ladder Name → Email → Goal → Plan. When the counterpart is a *salesperson / bot / competitor / spam*, we still treat them as a fitness lead.
2. **Name extractor accepted "Tania" / "Vera" from a sales pitch.** Once "name" was stored, `askNextMissing()` (line 1551), `enforceNoRepeatNameAsk()` (line 1615), `sanitizeFoundersPhaseText()` (line 1691) and `buildNoReplyFallback()` (line 1775) ALL fall through to the same hard-coded line: `Thanks, <name> — what's the best email for your Founding Member invite? ✨`.
3. **No anti-repeat cooldown on the email ask itself.** The duplicate-guard (line 1586) only dedupes *interactive* payloads, not this plain-text prompt. Result: 9 identical email asks in one thread.
4. **No handling of explicit opt-outs / off-topic pitches.** Vera said "we won't message you again" — we replied with the same email ask.
5. **Model output was overridden by guards.** Even when Gemini produced context-aware copy, the "founder's-phase sanitizer" and "name-repeat guard" rewrote it back to the robotic ladder line.

Net effect: the AI can't "think" — the guardrails force it onto rails regardless of what the human said.

---

## Plan — make the AI understand before it answers

### A. New pre-brain intent gate (`_shared/ai-intent-classifier.ts`)
Cheap Gemini-Flash-Lite classification of every inbound message from *unknown* contacts, before the main brain runs. Returns one of:

- `genuine_lead` — normal fitness enquiry → existing flow.
- `solicitation` — B2B pitch, agency, vendor, marketplace (magicpin/JustDial/Vera/etc.), affiliate, ad-service.
- `spam_bot` — automated marketing broadcast, template pitch, payment link push.
- `opt_out` — "stop / don't message / not interested".
- `wrong_number / off_topic` — casual chat, jokes, tests.
- `abusive` — profanity/harassment.
- `ambiguous` — fall back to normal flow but skip aggressive capture.

Signals fed to the classifier: last 6 turns, sender display name, whether *they* opened with a pitch, presence of URLs/prices/₹/trial/subscription/agency keywords, and whether the "name" they gave matches known solicitor patterns (Vera, magicpin, growth team, etc.).

### B. Route by intent, don't just capture
In `ai-agent-brain.ts` (near the top of the reply path, before `askNextMissing`):

| Intent | Behaviour |
|---|---|
| `solicitation` / `spam_bot` | One-time polite decline: *"Thanks, but Incline handles growth in-house — please don't add this number to outreach lists."* Then set `whatsapp_chat_settings.do_not_contact = true` and pause AI on the thread. |
| `opt_out` | Acknowledge, call existing `mark_do_not_contact` RPC, stop. |
| `wrong_number / off_topic` | Short human reply, no capture ladder. |
| `abusive` | Silent handoff to staff, no auto-reply. |
| `genuine_lead` / `ambiguous` | Existing Name→Email→Goal→Plan flow. |

### C. Harden the name extractor
Reject as "name" anything that is:
- a known brand/agency token (magicpin, vera, tania when preceded by "I'm … from"),
- present in the same message as a URL, ₹ amount, "trial", "subscription", "growth team", "agency",
- longer than 3 tokens with marketing verbs.

Add these to `looksLikeRealName()` / the extractor so we stop storing "Tania" as the lead's name.

### D. Anti-repeat cooldown on plain-text asks
Extend the duplicate-guard (currently interactive-only, line 1568) to *also* dedupe the email/goal/plan text prompts. If the same ask has gone out ≥2 times in the last 6 outbound turns without a valid answer, escalate: **stop asking, hand off to staff, mark thread `needs_human=true`**.

### E. Give the model room to think
- Add a `<reasoning_first>` block in the system prompt: *"Before replying, silently classify the sender's intent (lead / solicitor / opt-out / off-topic). Only run the capture ladder for genuine leads."*
- Neuter `enforceNoRepeatNameAsk` and `sanitizeFoundersPhaseText` when intent ≠ `genuine_lead` — currently they force the robotic line even when the LLM did the right thing.

### F. Training data (`ai_knowledge` rows, topic = `solicitor_handling`)
Seed 8–10 canonical examples so RAG retrieves them for future pitches:
- magicpin / Vera pitch
- JustDial / Sulekha listing sales
- SEO / Google-review agency
- WhatsApp API reseller
- Payment-gateway cold pitch
- Fitness-equipment vendor
- Influencer collab DM
- Job seeker
- Wrong number
- Casual "hi/test/joke"

Each row = trigger phrases + the exact response Yogita wants us to send.

### G. Admin surface
Add a new tab under **Settings → AI Agent → Training** called **"Non-lead responses"** where the owner can:
- edit the canned decline text,
- toggle auto-mark-DNC on solicitor detection,
- see a log of classified inbound (last 50) with the intent label and the reply we sent, plus a "reclassify" button that writes a correction back into `ai_knowledge`.

### H. Verification
1. Replay the Vera transcript through `ai-test-purpose` — expect exactly ONE polite decline + DNC, not 9 email asks.
2. Replay 5 real founding-member chats — expect the normal ladder to still complete.
3. Unit test the new name extractor on {"Vera", "Tania from magicpin", "Raj kumar suthar", "hi", "test"}.
4. Deploy `whatsapp-webhook`, `meta-webhook`, `ai-test-purpose`.

### Technical notes
- New file: `supabase/functions/_shared/ai-intent-classifier.ts` (~120 lines, one Gemini call, 200 ms budget, cached per inbound message id).
- Edits: `_shared/ai-agent-brain.ts` (intent gate + guard bypass), `_shared/ai-prompt.ts` (add `<reasoning_first>` block), `_shared/handoff.ts` (new `solicitor_detected` handoff reason).
- Migration: `ai_knowledge` seed rows + a new `ai_intent_log` table (message_id, intent, confidence, reply, created_at) for the admin log.
- No schema-breaking changes; existing lead flow untouched for `genuine_lead`.

