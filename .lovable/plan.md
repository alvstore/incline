## Root cause of the failed batch (12:09–12:12)

The Meta template used for the pre-launch campaign contains `Hi {{1}}, Thank you for registering …`. Every failing row was a lead with no captured `full_name` (rendered chat literally reads `"Hi , Thank you…"`). The pipeline then:

1. `send-broadcast` personalised the freeform body with `r.full_name || 'there'` → OK for freeform.
2. But the campaign was sent as an **approved Meta template** (`template_id` on the campaign), so `dispatch-communication` bypassed the freeform body and built `components.body.parameters` from `templateValues`.
3. `full_name` was empty → `resolveVarValue` returned `""` → `templateComponents()` substituted a single space `" "` for `{{1}}`.
4. Meta now rejects whitespace-only body parameters on newly-approved marketing templates → **error 132018 "parameters in your template"**. All 66 recipients fail with the same fbtrace family.

Secondary issues found:
- `send-broadcast` never forwards a `variables` map to the dispatcher, so the dispatcher has to *infer* `{{1}}` from the rendered body — fragile.
- Recipients with a blank name are still queued instead of being skipped or bucketed to a "no-name" template variant.
- On terminal template failures (132000/132012/132018/132001) the campaign is left at `status='failed'` with no auto-pause of the schedule, so the next scheduled batch keeps producing the same error.
- Campaign Wizard has no **"Send test to me"** / **dry-run preview** step against the real Meta template — the operator sees the freeform body, not the template-substituted output.

## Numbers 9928910901 & 9887601200

Both appear in the failed batch (`+91 99289 10901` at 12:10:56, `+91 98876 01200` at 12:11:23) with identical failure signature. The fix below re-queues them once the fallback is in place; nothing about those individual numbers is wrong — they're valid Indian mobiles and reachable per Meta pacing flags (`pace_limited:false`, `recipient_unreachable:false`).

## Plan

### 1. Dispatcher: never send whitespace-only template params
`supabase/functions/dispatch-communication/index.ts` (bump to v1.10.0)
- In `templateComponents()`, when a param resolves to empty/whitespace-only, substitute a **safe visible fallback per key type**: name-like keys → `"there"`, plan/trainer/branch → template `defaults[key]` or the branch name from `branch_settings`, amount/invoice → `"—"`, links → dropped (component omitted rather than sent as space).
- If any *required* body slot still has no meaningful value AND the template's approved category is MARKETING, **fail-closed at dispatch** with reason `template_param_empty:<key>` → the campaign row is marked failed for that recipient without hitting Meta. This eliminates 132018 loops.
- Extend the `META_HINTS` map with `132018` and reclassify 132000/132012/132018/132001 as **terminal** so `communication_retry_queue` will not requeue them.

### 2. send-broadcast: forward a real variables map
`supabase/functions/send-broadcast/index.ts` (v3.2.0)
- Build `perRecipientVars = { member_name, full_name, first_name, plan_title?, branch_name }` from the resolved recipient row and pass it as `payload.variables` to the dispatcher (both Path A and Path B).
- `first_name` = first token of `full_name`, else `"there"`. Never send `""`.
- If `channel === 'whatsapp'` AND `template_id` is set AND `full_name` is blank, insert the recipient row with `status='skipped', error='missing_required_variable:name'` and increment `skipped_no_name` — do not call dispatcher.

### 3. Campaign auto-pause on terminal template errors
`supabase/functions/send-broadcast/index.ts` + `campaigns` table
- After the batch loop, if the failure ratio ≥ 25% AND ≥ 3 failures share a terminal Meta code (132000/132012/132018/132001/131051), set `campaigns.status='paused_template_error'` and write `campaigns.error_summary = { code, hint, sample_recipients }`.
- `process-scheduled-campaigns` cron already checks `status='scheduled'`; a paused row will simply not fire again until the operator resumes it.

### 4. Campaign Wizard: template preview & test send
`src/components/campaigns/CampaignWizard.tsx` (Message step)
- When a Meta template is selected, render a **live preview** substituting sample values for each `{{key}}` (uses the same `orderedTemplateKeys` logic exposed as a small util).
- Add a "Send test to me" button that dispatches one message to the current user's phone with `variables = { member_name: 'Preview User', ... }`.
- Block "Schedule" if any recipient in the resolved audience is missing a value for a template-required key; show the count and a "Skip missing-name recipients" toggle (default ON) that maps to the same `skipped_no_name` path above.

### 5. Retry / re-run for the failed 66 rows
New RPC `retry_failed_campaign(p_campaign_id uuid)` (migration):
- Selects `campaign_recipients` where `status='failed'` and the error matches a *fixable* code (132018 with our new fallback), clears their status back to `pending`, and re-invokes `send-broadcast` with the same `template_id` — now safe because dispatcher substitutes `"there"` instead of `" "`.
- Surface as a "Retry failed recipients" button on the campaign detail drawer (`src/pages/Campaigns.tsx` → CampaignDetailDrawer).

### 6. Observability
- Log every terminal 132xxx into `error_logs` via `log_error_event` with `source='whatsapp_template'` and `fingerprint = code + template_name` so SystemHealth de-dupes.
- Add a small "Recent template errors" card to the WhatsApp Coverage tab in the Templates Hub listing the last 20 unique `(template, code, count)` tuples.

## Verification (once implemented)

1. Local unit test on `templateComponents()` — empty & whitespace inputs must resolve to `"there"` (not `" "`).
2. Deno test on `dispatch-communication` with `{ template_id, payload:{ variables:{} } }` returns `{ status:'failed', reason:/template_param_empty/ }` **without** calling Meta.
3. Manual dry-run via new "Send test to me" button on the same template — expect delivered.
4. `retry_failed_campaign(<batch id>)` — expect 66 dispatches, ≥ 95% success (subject to Meta pacing).
5. Confirm `+91 99289 10901` and `+91 98876 01200` both show `status='sent'` in `communication_logs` after retry.

## Out of scope

- Changing the Meta template itself (owner's WABA action).
- Broader campaign UI redesign — only the Message step gets the preview + test-send additions.
