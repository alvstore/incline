# Fix Sarvam Voice AI: "no deployment matches this Agent ID" + edge error toast

## What is actually wrong

Two separate defects, both confirmed against the live config and the official Sarvam docs.

**1. The readiness gate demands something the Instant Outbound API does not need.**
The official contract (`POST https://apps.sarvam.ai/api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds`) requires only: `app_id`, `app_version`, `connection_id`, `agent_phone_number`, `user_phone_number`. It never references a deployment. Deployments (`app-authoring/v1/.../deployments`) exist to attach an agent to a phone number for **inbound** calls and campaigns.

Our backend currently makes a matching deployment a hard blocker, plus `deployment_active` and `phone_number_assigned`. The workspace has the agent committed and a number assigned but no deployment record matching the agent ID, so the card shows "Credentials are valid but no deployment matches this Agent ID" and locks the test call — even though outbound calling is fully configured.

Live config confirms everything Instant Outbound needs is present: org, workspace, `app_id = Conversatio-62daa499-e129`, version, connection ID, agent number `+918065383003`, key stored server-side, last check `connected`.

**2. Every business-rule rejection surfaces as "Edge Function returned a non-2xx status code".**
`sarvam-voice` returns HTTP 400/409 with a helpful `error` string for not-ready, DNC, cap, window, and duplicate cases. `supabase.functions.invoke` throws on non-2xx and the body is discarded, so the real reason never reaches the user.

## The fix

### Readiness (backend, `sarvam-voice`)
- New gate for `test_call_available`: connected + `app_id` + `app_version` + `connection_id` + `agent_phone_number`. These are exactly the documented outbound requirements.
- Deployment status becomes **informational**, not a blocker:
  - no matching deployment → an info note ("Inbound deployment not configured — not required for outbound calls"), never a blocker.
  - a matching deployment exists but is paused, inbound-only, or on a different version → a **warning** shown on the card, still not a blocker.
- `production_ready` keeps its existing hard requirements: readiness + a real successful test call + integration toggled on. Retention automation stays disabled and untouched.

### Error surfacing (backend + card)
- Business-rule rejections (`not_ready`, `do_not_contact`, `daily_cap`, `outside_window`, `concurrent_call`, `duplicate`) return HTTP 200 with `{ ok: false, error, code, readiness }`; genuine auth (401/403) and server (500) statuses are unchanged.
- `SarvamVoiceCard` reads `data.error` for `ok:false` responses and, when `invoke` still throws a `FunctionsHttpError`, parses the response body before falling back to the generic message. The Sarvam-side detail (e.g. an invalid connection ID) is shown verbatim, redacted of credentials.

### Checklist UI
Rework the "Complete Voice AI setup" list so it reflects the real contract: Sarvam connected · Agent ID & version · Telephony connection · Agent number · Successful test call · Integration switched on. Deployment appears as a separate optional line with its warning, not a red blocker.

## Verification
- Deploy the function, run `test_connection`, and confirm the card no longer shows the deployment blocker and the test-call button unlocks.
- Place one real test call to the configured test number (+91 98876 01200) and confirm either a placed call with an `attempt_id` and a `voice_call_attempts` row, or the exact Sarvam error text on the card.
- Confirm the cap, window, DNC, and concurrency guards still block and now show their real reason instead of the generic toast.
- Confirm retention automation remains off and nothing is dialled automatically.

## Files
- `supabase/functions/sarvam-voice/index.ts` — readiness gate, blocker/warning split, 200-with-error responses.
- `supabase/functions/_shared/sarvam.ts` — expose deployment lookup as advisory; no endpoint changes.
- `src/components/settings/SarvamVoiceCard.tsx` — error extraction, checklist copy, warnings vs blockers.

No migrations, no schema changes, no changes to WhatsApp, email, Instagram, RCS, or any other integration.
