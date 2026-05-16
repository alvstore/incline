## Audit findings

**1. OpenRouter free model 404s** — All three failing IDs have been retired by OpenRouter:
- `qwen/qwen3-235b-a22b:free` — gone
- `mistralai/mistral-7b-instruct:free` — gone
- `google/gemini-2.0-flash-exp:free` — gone (Google deprecated the experimental endpoint)

The legacy `meta-llama/llama-3.1-8b-instruct:free` and `meta-llama/llama-3.3-70b-instruct:free` IDs in our catalog are also no longer in OpenRouter's free collection (May 2026 ranking). That's why everything errors with "No endpoints found".

Currently-live free models from `openrouter.ai/collections/free-models` we should ship:
- `openrouter/auto` *(router that always picks an available free model — best default)*
- `openai/gpt-oss-120b:free`
- `openai/gpt-oss-20b:free`
- `deepseek/deepseek-v4-flash:free`
- `nvidia/nemotron-3-super-120b-a12b:free`
- `nvidia/nemotron-3-nano-30b-a3b:free`
- `nvidia/nemotron-nano-9b-v2:free`
- `z-ai/glm-4.5-air:free`
- `minimax/minimax-m2.5:free`
- `google/gemma-4-31b-it:free`

**2. Ollama (`http://31.97.232.17:11434`)** — Provider exists in dispatcher + catalog, but:
- Catalog still has placeholder `https://your-vps.example.com/v1/chat/completions` as base_url.
- Catalog forces `OLLAMA_API_KEY` secret_name (Ollama doesn't need one; dispatcher already skips `Authorization` if env var is empty — fine, no code change there).
- Model list is generic (`llama3.1:8b`, etc.) — should match what's actually pullable + add `qwen2.5`, `llama3.2`.

The edge dispatcher will accept the http:// URL — calls run server-side, no mixed-content issue.

## Changes

**`src/lib/ai/providerCatalog.ts`**
1. Replace `openrouter.models[]` with the live free list above; set `default_model` to `openrouter/auto` so any new install "just works".
2. Update `openrouter.help` to mention auto-router + link to `openrouter.ai/models?free=true`.
3. Update `ollama.base_url` placeholder to `http://31.97.232.17:11434/v1/chat/completions` (the user's VPS) and `ollama.help` to clarify the `/v1/chat/completions` suffix + that API key is optional.

**No edge-function changes needed** — `ai-dispatcher.ts` already handles Ollama (http + optional key) and OpenRouter correctly.

## After the change — what user needs to do

1. **OpenRouter rule**: open the rule in AI Purposes, re-pick provider = OpenRouter, model = `openrouter/auto` (or any of the new free IDs), hit Test → should return 200.
2. **Ollama**: in Settings → AI Providers, add Ollama, base URL `http://31.97.232.17:11434/v1/chat/completions`, leave API key blank, pick a model you've `ollama pull`'d (e.g. `llama3.1:8b`), Save → Test.

No DB migration. No edge function redeploy.
