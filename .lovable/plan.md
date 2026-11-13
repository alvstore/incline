# NVIDIA as a backup for the app's AI

## Goal
Your current AI keeps handling every reply (Ananya on WhatsApp/Instagram, website answers, drafts, insights). NVIDIA is used only when the current AI fails after its normal retries, for example when it's down, rate-limited, or out of credits. Members still get a reply instead of silence.

## Steps
1. **Store the key safely.** A secure form asks for a new NVIDIA key. Please create a new key first, because the one you pasted is visible in chat. It's saved as `NVIDIA_API_KEY` and never goes into code.
2. **Record NVIDIA as a backup provider** in the existing AI provider settings. It stays inactive as a main provider and is used only as the backup.
3. **Backup logic in the shared AI sender:** if the main AI fails with a temporary error (429, 5xx, timeout, network) or a credits/limit error (402/403 credit limit), the same request is retried once on NVIDIA. Errors caused by a bad request or a content refusal are not retried, per the gateway rules.
4. **Model:** use a current NVIDIA-hosted model, picked from NVIDIA's live model list during build (a recent Llama/Nemotron instruct model). Tool calls go to it only if the model supports them. Otherwise it answers in plain text.
5. **Visibility:** logs and Settings → AI show "answered by NVIDIA (backup)" whenever the backup was used.
6. **On/off switch:** setting `ai_nvidia_fallback` (default on) turns the backup off at once.
7. **Test:** a small test checks that only the right errors switch to NVIDIA. One live call to NVIDIA confirms the key works.

## Technical details
- `supabase/functions/_shared/ai-dispatcher.ts`: add a `nvidia` provider (base `https://integrate.api.nvidia.com/v1/chat/completions`, OpenAI-compatible, Bearer `NVIDIA_API_KEY`). Extend `callAI` so that when the primary is `lovable` and fails with an eligible error, it calls `executeCall` with the NVIDIA config, stripping the Lovable model id. Keep the existing non-Lovable→Lovable fallback unchanged.
- Pure helper `isFallbackEligible(err)` with a Deno/bun test.
- Redeploy the functions that import the dispatcher (11), including whatsapp-webhook, meta-webhook, capture-lead and ai-dashboard-insights.
- Add a rule to the functions AGENTS.md: NVIDIA is a fallback only and never the primary.
