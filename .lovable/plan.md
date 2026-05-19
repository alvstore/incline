## Goal
Consolidate three diagnostics edge functions — `test-integration`, `test-ai-provider`, `test-ai-tool` — into a single `diagnostics` edge function, without changing any caller behavior or breaking functionality.

## Why
- All three are staff-only "test/diagnose" endpoints with overlapping auth + CORS boilerplate.
- Only 3 call sites in the app (one each), so cutover is trivial.
- Reduces the function inventory and config.toml entries.

## New function: `supabase/functions/diagnostics/index.ts`
Single endpoint that dispatches on a `kind` field in the request body:

```
POST /functions/v1/diagnostics
{ "kind": "integration" | "ai_provider" | "ai_tool", ...originalPayload }
```

Behavior per kind = byte-for-byte the same logic as the existing function it replaces:
- `kind: "integration"` → current `test-integration/index.ts` body (511 lines)
- `kind: "ai_provider"` → current `test-ai-provider/index.ts` body (156 lines)
- `kind: "ai_tool"` → current `test-ai-tool/index.ts` body (131 lines)

Shared once at the top:
- CORS headers + OPTIONS preflight
- Service-role Supabase client
- Auth: `getUser(token)` → 401 if missing
- Staff role check against `user_roles` (`owner|admin|manager|staff`) → 403 if missing
- Top-level try/catch with consistent error JSON

Each handler keeps its own response shape so callers see identical payloads.

## Caller updates (3 files, 1 line each)
- `src/components/settings/IntegrationSettings.tsx:1520` → `invoke('diagnostics', { body: { kind: 'integration', ...existing } })`
- `src/components/settings/AIProvidersSettings.tsx:264` → `invoke('diagnostics', { body: { kind: 'ai_provider', ...existing } })`
- `src/components/settings/AIAgentControlCenter.tsx:500` → `invoke('diagnostics', { body: { kind: 'ai_tool', ...existing } })`

## Config
- `supabase/config.toml`: add `[functions.diagnostics]` with `verify_jwt = false` (we validate the JWT in code, matching the existing pattern of the three functions).
- Remove the three old `[functions.test-*]` blocks.

## Cleanup
- Delete `supabase/functions/test-integration/`, `test-ai-provider/`, `test-ai-tool/` directories.
- Call `supabase--delete_edge_functions` for those three names so the deployed copies are removed.

## Out of scope
- No behavior changes, no payload schema changes, no new auth model.
- No consolidation of unrelated functions (webhooks, workers, etc.) — only the three the user named.
- No deep audit of other edge functions (can be a separate follow-up if you want).

## Risks / Validation
- Risk: divergent response shapes between branches — mitigated by copying each handler verbatim into its own `case` block.
- Validation after build:
  1. From Settings UI, run "Test integration", "Test AI provider", and an AI tool test → expect identical UX.
  2. `curl` `diagnostics` with each `kind` (unauth → 401, non-staff → 403, valid staff → 200).

## Files touched
- new: `supabase/functions/diagnostics/index.ts`
- edit: `supabase/config.toml`
- edit: 3 caller components above
- delete: 3 old function dirs

Want me to proceed with this consolidation, or also expand to a broader audit (the "deep audit for all edge functions" part) before touching code?