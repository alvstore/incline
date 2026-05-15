## Audit findings

**1. Providers ARE wired, but one major path bypasses them.**
- `_shared/ai-runtime.ts → generateOnce` correctly calls `_shared/ai-dispatcher.ts → callAI`, which resolves `ai_provider_configs` by scope (per-scope provider → "all" default → hard fallback to Lovable). DB today has `scope=all → google/gemini-2.5-flash` (active default) and `scope=fitness_plans → openrouter`. So one-shot calls (lead-score, campaign-draft, dashboard-insight, fitness-plan, review-reply, automation, template-generate, lead-nurture, ai-auto-reply shim) DO honor providers.
- **`_shared/ai-agent-brain.ts` (the WhatsApp/IG/Messenger tool-calling brain) hardcodes `https://ai.gateway.lovable.dev` + `LOVABLE_API_KEY` in two places (lines 292, 334).** It never asks `ai_provider_configs`. This is the "all are using Lovable" symptom for the AI Tool Library — every chatbot turn with tools (membership lookup, slot booking, payments, escalation) is forced to Lovable regardless of the `whatsapp_ai` provider config.

**2. Purposes UI hides provider info.**
- `AIPurposesTab` only shows the per-purpose `model` string, never the resolved provider. Users see "google/gemini-3-flash-preview" everywhere and assume Lovable.
- Per-purpose `model` in `ai_purposes` overrides the provider's `default_model`, so a Google-scoped provider can be silently called with a Lovable-style model name.

**3. Duplicate / confusing prompt surfaces.**
- `WhatsAppAISettings` writes `organization_settings.whatsapp_ai_config.system_prompt` — currently merged inside `ai-agent-brain.mergePurposeIntoConfig` (purpose wins if non-empty, else legacy). Two editors, one effective field, no UI hint.
- `LeadNurtureSettings` writes `organization_settings.lead_nurture_config.nurture_prompt` — appended to the AI prompt inside `lead-nurture-followup`. Same dual-source confusion.
- User intent: keep a "Gym Context" / "Nurture Context" overlay, but make it clearly labeled as **additive** to the SSOT purpose prompt — not a parallel system prompt.

---

## Plan

### A. Route the WhatsApp brain through the provider dispatcher
- In `supabase/functions/_shared/ai-agent-brain.ts`, replace both raw `fetch("https://ai.gateway.lovable.dev/...")` calls with `callAI({ scope: "whatsapp_ai", messages, tools, tool_choice, model: aiConfig.model || undefined, supabase })` from `_shared/ai-dispatcher.ts`.
- Drop the `LOVABLE_API_KEY` hard-guard at the top; rely on the dispatcher's resolved provider key (still falls back to Lovable if no provider configured). Keep a soft skip if `callAI` throws.
- Result: the `whatsapp_ai` scope row in `ai_provider_configs` (or the "all" default) controls which provider serves the AI Tool Library. Tools, tool_choice, and JSON mode pass through unchanged.

### B. Make providers visible in the Purposes editor
- Extend `AIPurposesTab`:
  - Load `ai_provider_configs` (active rows).
  - For each purpose card, show a small badge: `Provider: google · gemini-2.5-flash (scope=whatsapp_ai)` resolved via the same precedence as `resolveProvider` (scope-specific → all → Lovable fallback).
  - In the edit Sheet, add an info box: "Provider is controlled in the **Providers** tab. Leave 'Model' blank to use the provider's default; override only if you need a different model on this provider."
  - Add a "Test" button that calls a tiny edge function to ping the resolved provider with a 1-token prompt and shows provider/model/latency.

### C. Clarify Auto-Reply "Gym Context" as an overlay (no schema change)
- Edit `WhatsAppAISettings.tsx`:
  - Rename label to **"Extra Gym Context (appended to AI System Prompt)"**.
  - Helper text: "This is added on top of the WhatsApp Replies purpose prompt (Settings → AI Agent → Purposes). Use it for current offers, pricing tweaks, or branch-specific notes. Leave blank to use only the purpose prompt."
  - Add a read-only collapsible preview that fetches `ai_purposes.whatsapp_reply.system_prompt` and shows the merged final prompt (purpose + overlay).
  - Keep the existing `auto_reply_enabled` and `reply_delay_seconds` controls — those are not duplicated anywhere.
- In `_shared/ai-agent-brain.ts → mergePurposeIntoConfig`, change merge semantics so the legacy `system_prompt` is **appended** to the purpose prompt (not replacing it when purpose is empty). Effective system prompt = `purpose.system_prompt + "\n\n" + legacy.system_prompt` (skip blanks).

### D. Same overlay treatment for Lead Nurture
- Edit `LeadNurtureSettings.tsx`:
  - Rename "Nurture AI Context" → **"Extra Nurture Context (appended to AI System Prompt)"** with the same helper line and a preview of `ai_purposes.lead_nurture.system_prompt`.
- `lead-nurture-followup/index.ts` already passes `nurture_prompt` via `systemOverride` to `generateOnce`, which appends to the purpose prompt. No edge-fn change needed beyond verifying the wording.

### E. Verification
- Read `ai_provider_configs`, set scope=`whatsapp_ai` to the same Google provider, send a test inbound WhatsApp; confirm `ai_call_logs` row shows `provider=google` (not `lovable`).
- Edit the `whatsapp_reply` purpose prompt + add overlay text in Auto-Reply tab; trigger a reply; confirm both segments appear in the captured prompt log.
- Check the Purposes tab now shows provider/model badges and the test ping returns the expected provider.

---

## Out of scope
- No new tables. All changes use `ai_purposes`, `ai_provider_configs`, `ai_call_logs`, `organization_settings` as they exist.
- No deletion of `WhatsAppAISettings` / `LeadNurtureSettings` — they keep the operational toggles (auto-reply on/off, delay, retries) and become overlays for context.
- No changes to the AI Tool Library tool list itself (tools UI stays identical; only the underlying model call routes through the dispatcher).

## Files

| File | Change |
| --- | --- |
| `supabase/functions/_shared/ai-agent-brain.ts` | Replace 2× hardcoded Lovable fetch with `callAI({ scope: "whatsapp_ai", ... })`; switch merge to append legacy prompt onto purpose prompt; drop hard `LOVABLE_API_KEY` gate. |
| `src/components/settings/AIPurposesTab.tsx` | Show resolved provider/model badge per purpose; info box in edit Sheet; add per-purpose "Test" button. |
| `src/components/settings/WhatsAppAISettings.tsx` | Relabel system_prompt → "Extra Gym Context (overlay)"; add helper + merged-preview from `ai_purposes.whatsapp_reply`. |
| `src/components/settings/LeadNurtureSettings.tsx` | Relabel nurture_prompt → "Extra Nurture Context (overlay)"; add helper + merged-preview from `ai_purposes.lead_nurture`. |
| `supabase/functions/test-ai-provider/index.ts` (existing) | Reuse for the Purposes "Test" button if shape matches; else add a thin endpoint that calls `callAI` with a fixed 1-token prompt for the chosen scope. |
