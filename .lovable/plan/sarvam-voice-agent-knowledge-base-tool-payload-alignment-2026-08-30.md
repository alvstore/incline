# Sarvam Voice Agent — Knowledge Base + Tool Payload Alignment

## Short answer on the knowledge base

You do **not** need to upload a knowledge base for the retention-call agent to work. Tools + instructions already cover everything the call needs, and a KB is the wrong place for live data (plan expiry, class timings, trainer name) because it goes stale and can't be branch-scoped.

Recommended: create **one small KB folder** only for stable, non-sensitive facts the agent may be asked about mid-call, and keep everything dynamic in the tools.

Suggested folder `incline-facts` containing a single Markdown file with:
- Club identity: The Incline Life by Incline, Sector 14, Udaipur, Rajasthan.
- Facilities: strength floor (Panatta), PT, Pilates, Yoga, Zumba, group classes, infrared sauna, ice bath, steam, recovery lounge, 3D body scan.
- General timings and what happens on a visit; recovery-facility etiquette.
- Explicit "never say" block: no prices/fees, no PT package names or session counts, no opening date, no medical advice — offer a callback instead.

Do NOT put in the KB: member data, pricing, package structures, opening date, staff phone numbers.

## The real gap found in the audit

The tool payloads described in the console do not match what the deployed endpoint expects.

`sarvam-agent-tools` resolves the caller by **phone number** (`phone` / `user_phone_number`). It never reads `member_code` or `branch_name`. With the payloads currently wired in the console:

- `get_member_context` returns `found: false`
- `get_class_schedule` returns "No branch could be resolved"
- `book_callback` returns `booked: false`
- `mark_do_not_contact` returns "No phone number supplied"

So all four tools would authenticate fine and then quietly do nothing useful.

Second mismatch: the agent has an input variable `gender` (defaulting to `female`), which Incline does not send. Our contract sends 10 variables; the agent expects 11.

## Proposed changes

### 1. Make the tools accept both identifiers (backend)
Update `supabase/functions/sarvam-agent-tools/index.ts` so member resolution tries, in order:
1. `member_code` (exact match, optionally scoped by `branch_name`)
2. `phone` / `user_phone_number` (existing path)

Also let `get_class_schedule` resolve a branch from `branch_name` when no member is found, and let `book_callback` / `mark_do_not_contact` work from `member_code` when phone is absent. Keep the existing token auth, rate limit, and `ai_tool_logs` auditing untouched.

### 2. Align the variable contract
Add `gender` to `AGENT_INPUT_VARIABLES` in `supabase/functions/_shared/sarvam.ts` and populate it from the member profile in the outbound payload, so the agent stops falling back to the `female` default. Also send `phone` alongside so the tools always have a fallback identifier.

### 3. Tool key
Do not paste the key into chat. Set it yourself in the Sarvam console's tool authentication field for all four tools. Retrieve it from **Settings → Integrations → Sarvam Voice AI → Reveal endpoints** (owner only) — it shows the tools URL, the header name `X-Incline-Tool-Key`, and the copyable value. If the console credential widget still doesn't render, we can rotate to a fresh token and you paste the new one into a plain header field.

## Technical scope

- `supabase/functions/sarvam-agent-tools/index.ts` — dual identifier resolution (member_code + phone), branch resolution by name.
- `supabase/functions/_shared/sarvam.ts` — add `gender` (and `phone`) to the input-variable contract.
- `supabase/functions/sarvam-voice/index.ts` — populate the new variables on test/outbound calls.
- `src/components/settings/SarvamVoiceCard.tsx` — reflect the updated variable list in the Reveal endpoints panel.
- No database migration required. No change to retention gating: retention calls stay disabled until readiness plus a successful test call.

## Verification

- Curl each of the four tools with `member_code`-only, `phone`-only, and both — expect real data back, not `found: false`.
- Confirm a wrong/missing tool key still returns 401.
- Confirm `ai_tool_logs` records one row per call with branch scoping.
