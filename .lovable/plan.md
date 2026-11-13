# Fix "Add AI Provider" panel: show NVIDIA and the latest models

## What's wrong
- The **Provider Type** list in the panel is typed out by hand, separately from the provider catalog. NVIDIA was added to the catalog but never to this list, so you can't pick it.
- "Google Gemini (direct)" is in the list but has no saved settings, so choosing it leaves the address, key and models blank.
- Model lists are fixed in code, so they go out of date as providers release new models.

## What changes
1. **Provider Type list built from the catalog.** Every provider in the catalog shows up automatically, NVIDIA included. Adding a provider later is one catalog entry, with no second list to keep in sync.
2. **Google Gemini (direct) gets proper settings:** its address, key name and current models.
3. **"Refresh models" button next to the Model picker.** It asks the provider for its live model list, using the key you already saved. It works for NVIDIA, OpenRouter, Groq, Mistral, xAI, DeepSeek, Together, Ollama and custom providers. Results are cached for that provider. If the lookup fails (for example, the key isn't saved yet), you see a clear message and the built-in list stays.
4. **Model picker can be searched and still accepts a typed model name**, so a brand-new model can be used before it's added to the list.
5. **Fresh built-in lists.** NVIDIA's built-in list is updated from its live model list now (Nemotron 3 Ultra/Super, DeepSeek, Kimi, GLM, Mistral Large and others). The outdated Groq, Together, Mistral, Anthropic and xAI lists are refreshed where the providers publish them.
6. **Accessibility:** labels on the model picker and refresh button, a spoken status message after a refresh, and keyboard-friendly search.

Feature flag: none needed. This only changes the settings panel, and saved providers keep their chosen model.

## Technical details
- `AIProvidersSettings.tsx`: map `Object.entries(PROVIDER_DEFAULTS)` to SelectItems using `label`. Replace the model Select with a searchable combobox (Command + Popover) that also accepts free text. Add a Refresh button with `aria-live` status.
- `providerCatalog.ts`: add a `google` preset (generativelanguage OpenAI-compatible endpoint, `GEMINI_API_KEY`) and refresh the static lists.
- New edge function `ai-list-models`: requires an admin/owner JWT (via `can.manageSettings` / `has_capability`). Reads the provider row, resolves its secret on the server, calls `GET {base}/v1/models`, and returns only the ids. The key is never sent to the browser. Strict CORS, try/catch, version comment.
- Cache the result in the provider row's existing config JSON (`cached_models`, `cached_at`).
- Tests: every catalog provider appears in the Provider Type options (NVIDIA included); the `google` preset is complete; the model-id parser handles OpenAI-style `/models` responses.
