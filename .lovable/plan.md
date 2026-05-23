## Problem

`ai-generate-whatsapp-templates` returns 500. Edge logs show:

```
[ai-dispatcher] primary provider google failed: google HTTP 403:
"Your project has been denied access. Please contact support." (PERMISSION_DENIED)
```

The active default AI provider for scope `all` is **Google** (direct `generativelanguage.googleapis.com` via your `GOOGLE_API_KEY`). That Google Cloud project has been **blocked by Google** — every request now returns 403. This is a Google-side account block, not a code bug.

The dispatcher *does* attempt fallback to Lovable AI (because `enable_fallback=true` on the row), but:
1. The fallback strips the model + sends the same `tools` schema to Lovable. When Gemini-on-Lovable replies without a tool_call (which happens when the upstream is degraded or the prompt batch is too large), the function ends with `allTemplates.length === 0` → `500 "AI returned no proposals"`.
2. Even when fallback works, every call eats a 60s timeout retry on the dead Google key first — slow + noisy logs.

## Fix (two layers)

### 1. Stop calling the dead Google key — switch default provider to Lovable AI

In `ai_provider_configs` (scope=`all`):
- Set the **Google** row `is_default = false` (keep it active so you can switch back later if Google restores the project).
- Set the **Lovable AI** row `is_default = true`.

This is one migration, no code change. All AI features (template generation, campaign drafts, dashboard insights, lead nurture) immediately route to Lovable AI gateway, which has no per-project auth issue.

### 2. Harden `ai-generate-whatsapp-templates` so a partial AI failure no longer surfaces as 500

In `supabase/functions/ai-generate-whatsapp-templates/index.ts`:
- When `r.toolCallArgs` is missing, try a **one-shot retry without `tools`** asking the model to return JSON via `response_format: json_object` matching the same schema. Parse `r.json` instead.
- If after retry `allTemplates.length === 0`, return **502** with a clear message (`"AI provider returned no usable output — try again or switch provider in Settings → AI."`) instead of generic 500. 502 = upstream issue, matches existing 429/402 handling.

### 3. (Optional, recommended) Surface provider health in the UI

The Templates → "Generate with AI" drawer already shows errors via toast. Add a small one-liner under the button: *"Active AI provider: {provider_display_name}"* sourced from `ai_provider_configs` (default row). Lets you spot when you're on a dead provider without digging into logs.

## Out of scope

- No change to Lovable AI account, billing, or credits.
- No change to `ai_purposes` rows.
- No changes to the WhatsApp template approval flow (`manage-whatsapp-templates`) or Meta API.

## Verification

1. Run the migration → confirm `select provider, is_default from ai_provider_configs where scope='all' and is_default=true;` returns `lovable`.
2. Open Settings → Communication Templates → WhatsApp → "Generate with AI", select a few events, Generate. Should complete in <15s, no 500, no Google 403 in edge logs.
3. Tail `ai-generate-whatsapp-templates` edge logs — should see `provider=lovable status=success` rows.

## Note on the underlying Google block

The 403 means your Google AI Studio / Cloud project itself was blocked (TOS, billing, or fraud signal). To restore Google as a provider you'd need to either appeal to Google support or create a new GOOGLE_API_KEY from a different Google account and update the secret. Until then, Lovable AI is the right default.
