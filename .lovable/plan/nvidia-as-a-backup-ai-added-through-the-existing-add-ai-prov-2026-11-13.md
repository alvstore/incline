# NVIDIA as a backup AI, added through the existing "Add AI Provider" panel

## Goal
Nothing gets hard-coded. NVIDIA becomes a normal choice in Settings → AI Agent → Providers → Add AI Provider, the same as OpenRouter or Groq. Lovable AI stays the main provider. You pick NVIDIA in the panel as the backup that answers whenever the main AI fails.

## Steps
1. **NVIDIA in "Provider Type".** Choosing it fills in the endpoint (`https://integrate.api.nvidia.com/v1/chat/completions`), suggests current NVIDIA models, and fills the key name `NVIDIA_API_KEY`. You can edit every field.
2. **Refresh every provider's models and endpoints** in the panel's list (Lovable, OpenRouter, Groq, Together, DeepSeek, Mistral, Anthropic, xAI, NVIDIA), checked against each provider's current documentation and newest-first. Retired models are removed and endpoints that have moved are corrected. Providers you already saved keep their chosen model.
3. **A "Backup provider" choice in the panel.** The current switch only says "Auto-fallback to Lovable AI". It becomes a dropdown listing all of your active providers, so Lovable AI can name NVIDIA as its backup and NVIDIA can name Lovable as its backup.
4. **Shared AI sender follows that choice.** If the main provider fails with a temporary error (busy, down, timeout) or a credits/limit error, the request is retried once on the chosen backup. Bad requests and content refusals are never retried. The backup uses its own default model.
5. **Key.** A secure form asks for `NVIDIA_API_KEY`. Please paste a newly created key, because the one in chat is exposed.
6. **Your setup after the build:** add NVIDIA in the panel (Active on, not default), then open Lovable AI and set its backup to NVIDIA. I'll do one live test call through NVIDIA to confirm.

## Technical details
- `src/lib/ai/providerCatalog.ts`: add an `nvidia` entry and update the model/base_url lists. Update `providerCatalog.test.ts`. Mirror the `normalizeModelForProvider` change in the dispatcher.
- Migration: add `fallback_provider_id uuid null` (self-reference, on delete set null) to `ai_provider_configs`. The existing `enable_fallback` keeps meaning "fallback to Lovable" when no id is set, for back-compat.
- `AIProvidersSettings.tsx` drawer (Sheet): Backup provider select (None / Lovable AI / other active rows except itself).
- `_shared/ai-dispatcher.ts` `callAI`: resolve the backup from `fallback_provider_id`, otherwise use the legacy Lovable fallback. Pure `isFallbackEligible(err)` (429/5xx/timeout/network/402/credit-limit 403) with a test. Select the new column in every query.
- Redeploy the 11 functions that import the dispatcher.
