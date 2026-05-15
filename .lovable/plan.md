## Root cause of the fallback

Test pings `whatsapp_reply` and `all` purposes. Active provider for both scopes is **Google direct** (`generativelanguage.googleapis.com`). But `ai_purposes.model` is seeded with `google/gemini-3-flash-preview` (a Lovable-namespaced ID). Google's API returns:

```
404 models/google/gemini-3-flash-preview is not found
```

Dispatcher then falls back to Lovable — exactly what you see in Call Logs and the green "fallback" toast on Test.

So three things to fix together:

1. Stop sending Lovable-style model IDs to non-Lovable providers.
2. Make the Purposes UX self-correct (no free-text typos, defaults shown clearly).
3. Refresh the provider catalog so people pick valid models.

## Plan

### 1. Dispatcher safety net (`_shared/ai-dispatcher.ts`)

Add a `normalizeModelForProvider(provider, model)` step inside `executeCall`:

- For `google`: strip a leading `google/` prefix, and map `gemini-3-flash-preview` → `gemini-flash-latest`, `gemini-3.1-pro-preview` → `gemini-2.5-pro` (Google direct API doesn't expose Lovable preview names).
- For `openrouter`: pass through (it accepts `vendor/model` style).
- For `lovable`: if model has no `/`, prefix with `google/` (best-effort).
- For everything else: pass through.

This prevents a single mismatched override from silently degrading every AI call.

### 2. Purposes UI/UX upgrade (`AIPurposesTab.tsx`)

- Replace the free-text **Model override** input with a `Select` populated from the active provider's catalog (sourced from the same `PROVIDER_DEFAULTS` map used in `AIProvidersSettings.tsx`, lifted into a shared `src/lib/ai/providerCatalog.ts`). First option = "Use provider default ({model})".
- Show **effective model after normalization** as a small caption under the picker so the user sees exactly what will be sent.
- Add a **"Reset to recommended defaults"** button per-purpose that re-applies the recommended temperature, max_tokens, and clears the model override.
- Card layout: split metadata into 2 rows — row 1 title + status + provider/model badges; row 2 short description + temp/tokens chips. Make Test/Edit a sticky right-side button group so they're always reachable.
- Test toast: when `fallback_used=true`, render as **warning** (not success) with the primary error message — currently it shows green even on fallback.

### 3. Smart per-purpose defaults

Build a `PURPOSE_DEFAULTS` table and prefill on Edit when fields are null:

```text
purpose            | temp | max_tokens
-------------------+------+-----------
whatsapp_reply     | 0.6  | 600
lead_nurture       | 0.7  | 400
lead_score         | 0.2  | 500   (JSON output)
campaign_draft     | 0.8  | 800
template_generate  | 0.4  | 600
dashboard_insight  | 0.3  | 1200
fitness_plan       | 0.5  | 2500
review_reply       | 0.6  | 400
automation_rule    | 0.5  | 400
```

Migration backfills existing rows where `temperature IS NULL OR max_tokens IS NULL`, and clears the bad seeded `google/gemini-3-flash-preview` overrides so each purpose inherits its provider's `default_model`.

### 4. Provider catalog refresh (`AIProvidersSettings.tsx` + new `src/lib/ai/providerCatalog.ts`)

- **Lovable**: add `google/gemini-3.1-flash-lite-preview`, `openai/gpt-5.4`, `openai/gpt-5.4-mini`, `openai/gpt-5.4-pro`, `openai/gpt-5.5`, `openai/gpt-5.5-pro`. Default → `google/gemini-3-flash-preview` (matches Lovable knowledge default).
- **Google direct**: keep GA models only (`gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-pro-latest`). Default → `gemini-flash-latest`.
- **OpenRouter**: refresh free tier list (drop `:free` models that 404; add `meta-llama/llama-3.3-70b-instruct:free`, `google/gemini-2.0-flash-exp:free`, `deepseek/deepseek-chat-v3.1:free`, `qwen/qwen3-235b:free`).
- **DeepSeek / Groq / Together / Mistral**: minor refresh; no behavior change.
- Add `anthropic` (`claude-sonnet-4`, `claude-opus-4`) and `xai` (`grok-2`, `grok-2-mini`) presets so users can pick them; dispatcher already supports `openai_compatible` via `base_url`, so just add presets that render those provider rows.

### 5. Verification

- Re-run **Test** on every purpose. Expected: provider badge = `google`, no `(fallback)`, latency < 2s.
- New Call Logs entries should show `status=success`, not `fallback`.
- Edit a purpose → model picker lists Google catalog → save → Test → still success.
- Switch active provider in Providers tab to OpenRouter → Edit purpose → picker now shows OpenRouter catalog.

## Files to touch

- `supabase/functions/_shared/ai-dispatcher.ts` — model normalization
- `supabase/functions/ai-test-purpose/index.ts` — also pass normalized model so UI matches
- `src/lib/ai/providerCatalog.ts` (new) — single source for provider presets + per-purpose defaults
- `src/components/settings/AIPurposesTab.tsx` — model dropdown, defaults prefill, reset button, fallback-aware toast
- `src/components/settings/AIProvidersSettings.tsx` — import catalog from new shared file
- One migration: backfill `ai_purposes.temperature`, `max_tokens`; null-out the broken `model` overrides

## Out of scope

- No changes to provider scope routing (still per-`scope`).
- No changes to `WhatsAppAISettings`/`LeadNurtureSettings` overlay logic (already shipped Wave 3).
- No new tables.
