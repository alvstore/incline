# WhatsApp Broadcast & Audience Reliability Plan

## Verified findings

- `Everyone at the club` returns zero in the wizard because the preview calls `resolve_campaign_audience_v2`, which has no `staff` or `members_and_staff` branch. Actual broadcast execution uses the older resolver, so preview and send-time audiences can disagree.
- The selected branch currently has 125 members with phone numbers, 8 active trainers with phone numbers, 1 active employee with a phone number, plus owner/admin/manager profiles. Final audience totals must be deduplicated by normalized phone number because people may hold overlapping roles.
- Marketing Messages routing is enabled, but it is selected only when the app’s internal category is `marketing`. Lead-alert templates reclassified by Meta as MARKETING still use the Cloud API.
- There were 213 Meta `131049` failures to only two recipients in the last 24 hours. The Hari lead alert alone generated 105 failed records for each of two recipients.
- A failed-delivery trigger puts failed messages into `communication_retry_queue`. The active retry worker does not classify `131049` as terminal, and retry dispatch uses `force: true`, bypassing the current marketing cooldown.
- One `131049` campaign item is currently pending retry. The legacy WhatsApp retry worker already treats `131049` as terminal, confirming inconsistent retry policy between workers.

## Implementation

### 1. Make one audience resolver authoritative

- Extend `resolve_campaign_audience_v2` to support `staff` and `members_and_staff`.
- Include active branch members, trainers, employees, managers, admins, and owners according to branch visibility rules.
- Require the destination needed by the selected channel and deduplicate recipients by normalized phone/email before returning totals.
- Preserve v2 fields such as WhatsApp 24-hour-window state and source label.
- Update broadcast execution to use the same v2 resolver as the live preview, removing preview/send divergence.
- Keep database execution limited to authenticated users and backend service calls.

### 2. Stop 131049 resend storms

- Classify Meta `131049` as terminal for the current message in `process-comm-retry-queue`; never retry it after 5/30/120 minutes.
- Harden the database enqueue trigger so callback failures containing `131049` are not inserted into the retry queue at all.
- Mark any existing pending/processing `131049` rows as exhausted with a clear pacing reason.
- Make pacing suppression apply to WhatsApp template sends regardless of internal category and ensure `force` cannot bypass safety/policy blocks.
- Key the 24-hour cooldown by normalized recipient and resolved Meta template so unrelated transactional templates are not blocked.

### 3. Route eligible templates correctly

- Determine Marketing Messages API eligibility from the resolved template’s live Meta category/send-risk, not only the app category string.
- When `mm_api_enabled` is active and a template is Meta MARKETING, pass the Marketing Messages hint to `send-whatsapp` for broadcasts and category-drifted lead alerts.
- Retain the official Cloud API for utility/authentication templates, inbound replies, and any send not eligible for Marketing Messages.
- Surface the provider route (`mm_api` or `cloud_api`) in delivery metadata for support diagnostics.

> The official API remains necessary for approved templates, consent controls, delivery/read callbacks, media, compliance, and inbox synchronization. Marketing Messages is an eligible route within Meta’s official platform; it reduces some marketing-delivery friction but cannot guarantee delivery or override recipient quality/engagement controls.

### 4. Prevent repeated internal lead alerts

- Keep the atomic per-lead claim, but add recipient/template-level cooldown and stable dedupe protection so retries or duplicate capture paths cannot fan out the same alert repeatedly.
- When Meta reports `131049`, record one paced/suppressed result and continue enabled fallback channels without generating new WhatsApp attempts.
- Preserve the original provider error in the Communication Hub while labeling it `Paced / Suppressed`, not as a generic technical failure.

### 5. Verification

- Database test: resolve `members_and_staff` for the INCLINE branch and verify non-zero, role-inclusive, phone-deduplicated results.
- UI test: `Everyone at the club` displays the same deliverable count used by the send flow.
- Worker test: a synthetic `131049` row becomes exhausted without invoking the dispatcher.
- Routing test: an approved MARKETING template records `provider_route: mm_api`; utility templates record `cloud_api`.
- Curl test the affected edge functions with dry-run/test recipients only; do not broadcast to the club during verification.
- Recheck database rows and function logs to prove no new retry-loop entries are created.
- Run focused function tests, app build validation, and inspect the Communication Hub in the browser.

## Acceptance criteria

- `Everyone at the club` includes deliverable members, trainers, staff, managers, admins, and owners with no duplicate phone recipients.
- Preview count and send-time recipient count come from the same resolver.
- A `131049` callback produces no automated resend during the 24-hour cooling period.
- `force: true` cannot override pacing, consent, opt-out, or invalid-recipient safeguards.
- Eligible marketing broadcasts use Meta Marketing Messages routing when enabled; all routes remain observable.
- Existing queued `131049` work is safely exhausted, and no live club-wide message is sent as part of testing.
