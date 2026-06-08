## Two distinct issues to fix

### A. Raw JSON envelopes leak into Instagram/Messenger replies

The brain sometimes returns `replyText` that is a structured envelope (`{"type":"interactive_list",…}` for goal/plan-interest steps, or `{"status":"lead_captured",…}` from the LLM).
- `whatsapp-webhook` has `tryExtractInteractiveJson()` that converts these to native WhatsApp interactive messages or to a numbered-bullets text fallback.
- `meta-webhook` has **no equivalent** — it inserts the raw JSON string into `whatsapp_messages.content` and forwards it to `send-meta-dm`, which sends it as `message.text`. Result: IG / Messenger users see raw `{"type":...}` text.

### B. Persona / rules / Founder's Phase guardrails are hardcoded in edge functions

The AI Brain UI (`ai_purposes` + `ai_knowledge`) is supposed to be the single source of truth, but ~200 lines of prompt text are still appended in code, plus four other edge functions skip the brain entirely.

## Changes

### Track 1 — Stop JSON from reaching Meta DMs

1. **Extract** the existing `tryExtractInteractiveJson` logic from `supabase/functions/whatsapp-webhook/index.ts` into a new `supabase/functions/_shared/chatEnvelope.ts` so both webhooks share one parser. Keep WhatsApp behaviour identical.
2. **Update `meta-webhook`** (the IG / Messenger AI reply path at lines 1318–1395):
   - Call `parseChatEnvelope(result.replyText)` before any insert/send.
   - If the envelope is `interactive_list` / `interactive`: render as a plain-text numbered list (Meta IG/Messenger does not support WhatsApp-style interactive lists), e.g. `body\n1. Weight Loss\n2. Muscle Gain …`.
   - If the envelope is `lead_captured` (control payload): strip silently — never user-visible.
   - If the string still contains stray `{"type":...}` after parsing (e.g. LLM wrapped it in prose), strip the JSON blob and fall back to the surrounding prose, or to `"Got it — one moment."` if nothing remains.
3. **Final-line guard** in `chatEnvelope.ts`: a regex catches any leftover top-level `{…"type":"…"…}` blob and removes it. Both webhooks run this last.
4. **Save the cleaned text** to `whatsapp_messages.content`, not the raw envelope, so the inbox UI also stops showing JSON in conversation history.

### Track 2 — Move hardcoded prompts into the AI Brain UI

1. **Seed `ai_purposes` rows** that are missing or empty (migration, idempotent, `ON CONFLICT (purpose, branch_id) DO NOTHING` so user edits in the UI are never overwritten):
   - `whatsapp_reply` (already exists with Ananya persona — leave content alone; just ensure non-empty)
   - `review_reply` — seed with the current `google-reviews-brain` persona
   - `lead_score` — seed with the current `score-leads` prompt
   - `fitness_plan` — seed with the workout/diet personas from `generate-fitness-plan`
   - `ig_comment_dm` — seed with the IG-comment persona; re-use `whatsapp_reply` row instead if you prefer
2. **Move the inline blocks in `_shared/ai-agent-brain.ts` to the brain**:
   - Append the **Tool-usage** block, **Post-capture nurture** block, and **Founder's Phase capture protocol** to the `whatsapp_reply` purpose's `system_prompt` (via a one-shot migration that detects missing markers and appends only if absent — keeps the UI as SSOT going forward).
   - Add three `ai_knowledge` rows (priority ≤10 so they're always retrieved): `lead_capture_protocol`, `velvet_rope_pricing_rule`, `non_fitness_intent_handler`, scoped `applies_to = ['whatsapp_reply','all']`.
   - In `ai-agent-brain.ts`, replace the three `systemPrompt +=` blocks with a much thinner **runtime context** wrapper that only injects dynamic, per-turn facts (channel name, captured fields known-so-far, current onboarding step number). Persona / rules / Founder's Phase wording comes from the DB.
3. **Replace hardcoded personas in the other functions** with `buildSystemPrompt({purpose, branchId, userMessage, identity, defaultPersona})`:
   - `_shared/ig-comment-automation.ts` (line 426) → `buildSystemPrompt({purpose:'whatsapp_reply', …})` (or `ig_comment_dm` if you want a separate handle in the UI — recommend re-using `whatsapp_reply` for one persona everywhere).
   - `google-reviews-brain/index.ts` → `buildSystemPrompt({purpose:'review_reply', …})`.
   - `score-leads/index.ts` → `buildSystemPrompt({purpose:'lead_score', …})`.
   - `generate-fitness-plan/index.ts` → `buildSystemPrompt({purpose:'fitness_plan', …})`. Keep the structured-output schema separate.
4. **Keep `defaultPersona` literal strings** in code only as a safety net for when a DB row is deleted, never as the primary source. Add a console warning when the fallback fires so it shows up in `error_logs`.

### Out of scope (intentional)

- The deterministic onboarding short-circuits at `ai-agent-brain.ts` lines 533–611 — these are not prompt text, they are the safety path that fires when Gemini stalls. They will keep emitting the JSON envelope; Track 1 makes sure Meta strips/renders it correctly.
- No changes to `lead-nurture-followup` (already brain-driven), `embed-knowledge`, or the deleted `sync-ai-knowledge`.
- No model/provider changes, no schema changes to `ai_knowledge` or `ai_purposes`.

## Verification

- Send a fresh IG DM from a test account → progress through onboarding → confirm goal step renders as bullets, not JSON; `lead_captured` envelope never appears.
- Re-run the WhatsApp flow → confirm interactive lists still render natively (no regression).
- Inspect `Settings → AI Brain → Handles` → each of `whatsapp_reply`, `review_reply`, `lead_score`, `fitness_plan` shows non-empty system prompt; editing it changes live behaviour.
- `grep -nE "\"You are |systemPrompt\s*\+=" supabase/functions/` returns only `_shared/ai-prompt.ts` and the `defaultPersona` safety strings.

## Technical details

- New file: `supabase/functions/_shared/chatEnvelope.ts` (~80 lines: `parseChatEnvelope`, `renderInteractiveAsText`, `stripStrayJson`).
- Files edited: `whatsapp-webhook/index.ts` (refactor to use shared parser), `meta-webhook/index.ts` (add parser call before insert + send), `_shared/ai-agent-brain.ts` (replace 3 inline blocks with runtime context call), `_shared/ig-comment-automation.ts`, `google-reviews-brain/index.ts`, `score-leads/index.ts`, `generate-fitness-plan/index.ts`.
- One migration: idempotent UPSERT of `ai_purposes` rows that have no row yet, plus the 3 `ai_knowledge` seed rows. Uses `WHERE NOT EXISTS` / `ON CONFLICT DO NOTHING` so existing UI-edited values are preserved.
