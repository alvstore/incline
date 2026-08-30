# Sarvam Voice AI — live verification, doc conformance, and agent variables/tools

## What I verified now (read-only)

- The saved integration row now has everything it was missing: agent `Conversatio-d22b494d-8371`, version `1`, connection `3beb090c-97-…`, phone `+918065383003`, API key stored server-side, webhook token present, last check `connected`, master switch still off.
- Against the official docs, our adapter matches the published contract exactly: `X-API-Key` auth, deployments base `apps.sarvam.ai/api/app-authoring`, Instant Outbound `POST /outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds` with `app_config.app_id` + integer `app_version` + `connection_config` + `user_config.user_phone_number` + `webhook_config{url,metadata}`, response `{attempt_id}`. Unauthenticated probes returned `401` (deployments) and `422` (outbounds), confirming both endpoints are live and key-gated.
- Doc mismatches found in our code:
  - `channel_direction` is only `inbound | outbound | inbound_outbound`; our readiness also tests for `bidirectional`/`both` (dead branches).
  - Deployment `status` is only `active | paused`; we expose it as `phone_number_active`, which is misleading in the blocker list.
  - The webhook payload carries `channel_info`, `final_agent_variables` and `interaction_transcript`; we currently discard all three.
  - Header still shows `cap 50/day` because `config.daily_call_cap` is 50 while the retention block uses 25 — two different numbers on one screen.
- What I could NOT test from here: an authenticated call against Sarvam. The API key is server-side only, and printing it to run curl would leak it. The live curl must run through the edge function with an owner session, in build mode.

## Plan

### 1. Live verification (first step, before any code change)
- Mint an owner session and curl `sarvam-voice` with `{"action":"get_readiness"}`; print the full readiness object and blockers.
- Report exactly what Sarvam says about the deployment: does one exist for this agent, is it `active`, is `channel_direction` outbound-capable, and is `+918065383003` in its `phone_numbers`.
- If readiness passes, curl `{"action":"test_call","to":"+91…","confirmed":true}` once to a number you nominate, then read back the `voice_call_attempts` row and the webhook update.

### 2. Doc-conformance fixes
- Restrict the outbound-direction check to `outbound` / `inbound_outbound`; rename the flag pair to `deployment_active` + `phone_number_assigned` so blockers read truthfully.
- Paginate/search deployments by agent instead of a single 50-row page.
- Persist the full webhook outcome: `channel_info`, `duration`, `interaction_id`, `failure_reason`, and `final_agent_variables` + transcript into `context_payload`.
- Make the card header read the same cap the automation enforces.

### 3. Agent variables — so the agent knows who it is calling
Send a fixed, documented set of input variables on every outbound call (`app_config.agent_variables`):
`member_name`, `member_code`, `branch_name`, `days_absent`, `last_visit_date`, `plan_name`, `plan_expiry`, `trainer_name`, `preferred_language`, `call_reason`.

Read back these output variables from the webhook and store them on the attempt:
`call_disposition` (enum: `coming_back`, `callback_requested`, `not_interested`, `wrong_person`, `complaint`), `callback_datetime`, `reason_for_absence`, `next_step_agreed`.

Then act on them in Incline: a callback creates a task, a complaint creates a task for the branch manager, `not_interested` writes a cooldown, `wrong_person` flags the phone. Nothing is auto-dialled by this step.

### 4. Agent tools — so the agent can look things up mid-call
New public edge function `sarvam-agent-tools`, authenticated by a shared secret header, registered in Sarvam as API tools:
- `get_member_context` — membership, expiry, dues, last visit, trainer.
- `get_class_schedule` — next classes at the member's branch.
- `book_callback` — creates a task for staff at a requested time.
- `mark_do_not_contact` — honours an opt-out spoken on the call, immediately.

Each tool is read-scoped by member/phone, rate-limited, and logged to `ai_tool_logs`.

### 5. Safety (unchanged)
Retention automation stays off. It still requires production-ready + a successful test call. No cron, no bulk dialling, no DND/cooldown/window bypass in any part of this work.

## Technical notes

- Files: `supabase/functions/_shared/sarvam.ts`, `supabase/functions/sarvam-voice/index.ts`, `supabase/functions/sarvam-voice-webhook/index.ts`, new `supabase/functions/sarvam-agent-tools/index.ts`, `src/components/settings/SarvamVoiceCard.tsx`, `supabase/config.toml`.
- Migration: add a variables/outcome column set only if `context_payload` proves insufficient; otherwise none.
- Secret: one new shared secret for the agent-tools endpoint, which you paste into the Sarvam tool headers.

## What you will do in the Sarvam dashboard

Confirm the deployment for `Conversatio-d22b494d-8371` is active and outbound-enabled with +91 8065383003 assigned; add the input/output variables above on the Variables tab; register the four API tools with the shared secret; register the webhook URL.
