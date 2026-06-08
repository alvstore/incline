# AI Brain — JSON Leak & SSOT Audit (shipped)

## What landed
- New `supabase/functions/_shared/chatEnvelope.ts` — single source of truth for parsing brain envelopes (`interactive_list`, `interactive`, `lead_captured`) and rendering them as plain text. Exports `parseChatEnvelope`, `renderInteractiveAsText`, `stripStrayJson`, `flattenReplyForPlainText`.
- `meta-webhook` (v5.7.0) now flattens `result.replyText` via `flattenReplyForPlainText()` before insert + send. IG/Messenger DMs can no longer leak raw `{"type":"interactive_list",…}` or `{"status":"lead_captured",…}` JSON to users.
- WhatsApp path unchanged — still uses its existing extractor for native interactive rendering.
- Persona/rules duplication removed from auxiliary edge fns; all now rely on `ai_purposes.<purpose>.system_prompt` from the AI Brain UI:
  - `score-leads` — stripped "You are a gym CRM lead scoring assistant…"
  - `google-reviews-brain` — stripped "You are a gym customer-service AI…"
  - `generate-fitness-plan` — stripped "You are an expert fitness trainer/nutritionist…", kept only OUTPUT-CONTRACT JSON schema (needed for parsing)
  - `_shared/ig-comment-automation.generateAiReplyEphemeral` — routed through `generateOnce({purpose:"whatsapp_reply"})` so IG comment→DM uses the Ananya brain. Callers (`process-ig-comment-runs`, `meta-admin`) now pass `supabase` + `branchId`.
- All 9 `ai_purposes` rows already had non-empty personas — no DB seed required.

## Out of scope (kept as-is on purpose)
- `_shared/ai-agent-brain.ts` inline blocks (tool usage / post-capture nurture / Founder's Phase). They interpolate per-turn runtime facts (KNOWN-SO-FAR fields, sender ID, gym name) and are the safety path when Gemini stalls. Moving them to DB would need a templating layer and risk re-introducing the crashes the user just got past. The `whatsapp_reply` system prompt in DB still drives persona; these blocks are additive runtime context.
- Deterministic onboarding short-circuits in `ai-agent-brain.ts` lines 533–611 — they still emit `JSON.stringify({type:"interactive_list",…})`. WhatsApp renders natively; meta-webhook now flattens to plain text.

## Verification
- IG DM goal/plan step → user sees `1. Weight Loss\n2. Muscle Gain\n…` instead of raw JSON.
- WhatsApp interactive list still renders natively (no regression — code path untouched).
- `grep -E '"You are |systemPrompt\s*\+=' supabase/functions/` returns only the `defaultPersona` safety string in `ai-agent-brain.ts` and the runtime blocks documented above.
