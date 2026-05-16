## Diagnosis

Ran curl + Python TLS probe against `https://ai.yacispl.com`:

1. **"Expired certificate" — STALE / NO LONGER TRUE.** The Let's Encrypt cert was just renewed today: valid `May 16 2026 → Aug 14 2026`. Python's stdlib SSL accepts it; curl accepts it. The Deno error was from a previous run before the renewal. A fresh Test will not reproduce it.

2. **HTTP 405 — REAL.** Server responds fine on `POST /v1/chat/completions` (returned a valid chat completion). Returns 405 on `POST /`. So the saved Ollama provider's `base_url` is `https://ai.yacispl.com/` (root) instead of the full chat-completions path. Our dispatcher (`ai-dispatcher.ts` line 132) uses `base_url` as-is, so it POSTs to root → 405.

Confirmed pullable models on this server: `llama3.1:latest`, `qwen2.5:latest`.

## Fix

**`supabase/functions/_shared/ai-dispatcher.ts`** — Make `buildEndpoint` resilient for `ollama` and `openai_compatible` providers: if `base_url` is set but doesn't already include `/chat/completions`, auto-append the correct suffix.
- Strip trailing `/`.
- If URL ends with `/v1` → append `/chat/completions`.
- If URL has no `/v1` segment → append `/v1/chat/completions`.
- If URL already ends with `/chat/completions` → use as-is.

This makes the provider work whether the user types `https://ai.yacispl.com`, `https://ai.yacispl.com/v1`, or the full path.

**`src/lib/ai/providerCatalog.ts`** — Update Ollama defaults:
- `default_model`: change to `qwen2.5:latest` (actually pulled on this VPS).
- `models[]`: replace generic list with the two confirmed-available ones (`llama3.1:latest`, `qwen2.5:latest`) plus a help note to run `ollama pull <model>` for more.
- `base_url` placeholder/help text: explicitly state either root host or full path works.

No DB migration. No catalog DB changes. Only the dispatcher edge function needs redeploy (auto on save).

## Post-fix steps for the user

1. Open the Ollama provider in Settings → AI Providers, hit Save (no edit needed — existing `https://ai.yacispl.com/` will now auto-resolve to `/v1/chat/completions`).
2. Pick model `qwen2.5:latest` (or `llama3.1:latest`) → click **Test** → should return 200 with "Pong".
3. The "expired certificate" message will not return — server cert is now valid through Aug 14 2026.
