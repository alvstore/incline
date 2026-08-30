# Sarvam Voice AI — Settings → Integrations

## Audit of current state

Most of this integration already exists in the codebase from earlier work, and the database layer is live:

- `voice_provider_integrations`, `voice_provider_secrets`, `voice_call_attempts` exist in the live schema (confirmed in generated types) with branch scoping and owner/admin RLS; the secrets table has no client grants.
- `supabase/functions/_shared/sarvam.ts` (288 lines) is the single server-side adapter: official base URLs, `X-API-Key` auth, redaction, typed errors, status normalization.
- `supabase/functions/sarvam-voice/index.ts` (409 lines) exposes owner/admin actions: `get_state`, `save_config`, `save_automation`, `set_active`, `test_connection`, `test_call` with IST window, DNC, daily cap, concurrency and duplicate guards.
- `supabase/functions/sarvam-voice-webhook/index.ts` (49 lines) is token-authenticated and only updates the call ledger.
- `src/components/settings/SarvamVoiceCard.tsx` (563 lines) is wired into `IntegrationSettings.tsx` as the "Voice AI" tab.

What is NOT yet done: verification, deployment/config, doc-accuracy confirmation of the outbound endpoint, and the retention foundation hookup.

## Plan

1. **Verify against official docs** (`/conversations/overview`, `/deploy/telephony`, `/deploy/campaigns/campaign-lifecycle`, `/build/tools/https-tool`, `/build/variables-personalization`): confirm the Instant Outbound endpoint/payload shape and deployment-listing endpoint used in `_shared/sarvam.ts`. If the docs do not expose a supported single-call API for our setup, replace the test-call action with a disabled state plus a "Manual test in Sarvam Voice Agents" link — no invented endpoints, no fake calls.
2. **Deploy the two edge functions** and add `sarvam-voice-webhook` to `supabase/config.toml` with `verify_jwt = false` (token in query string is its auth); `sarvam-voice` stays JWT-verified.
3. **Type/build hardening**: replace any remaining `any` in the adapter with `unknown`/typed responses, run typecheck and build, fix fallout.
4. **Card polish and states**: confirm loading skeleton, error, and empty states; masked key metadata only; connection/deployment status driven by real `test_connection` output; recent attempts read from `voice_call_attempts`.
5. **Retention foundation (disabled by default)**: keep "Member Retention Calls — 7+ days absent" stored via `save_automation` in the integration config only. No cron, no automation-brain rule, no calls placed. Document the follow-up needed to activate it.
6. **Regression check**: confirm WhatsApp, Email, Instagram, RCS, campaigns and other Integration tabs are untouched.

## Files to change

- `supabase/functions/_shared/sarvam.ts` — typed responses, doc-verified endpoints.
- `supabase/functions/sarvam-voice/index.ts` — adjust test-call path if docs require manual-test fallback.
- `supabase/functions/sarvam-voice-webhook/index.ts` — minor correlation/robustness fixes if needed.
- `supabase/config.toml` — webhook function entry with `verify_jwt = false`.
- `src/components/settings/SarvamVoiceCard.tsx` — state/copy polish, manual-test fallback UI if required.
- No migrations expected (tables already live).

## Manual Sarvam dashboard actions (out of code scope)

API key, org/workspace IDs, agent app ID + version, telephony connection ID, and the from-number (+91 8065383003 — read back from the provider rather than hard-coded), plus registering the webhook URL with the generated token.

## Risks

- If the outbound API is not documented for our plan, the single test-call button becomes a manual link — this is the intended fallback, not a gap.
- Provider status vocabulary may change; normalization lives only in the adapter.
