# Production Communication & Campaign Hardening

## Audit scope and confirmed baseline

The existing architecture will be preserved: Campaign UI → audience resolver → `campaigns` / `campaign_recipients` → `send-broadcast` → `dispatch-communication` → channel provider → webhook/reconciler → delivery logs → campaign counters/retries.

Confirmed from source and live database inspection:

- Campaigns currently have `draft`, `scheduled`, `sending`, `sent`, `failed`, `paused`, and `pending_template_approval`, but not `materializing` or `cancelled`.
- Recipient rows currently support `pending`, `dispatching`, `queued`, `sent`, `failed`, `suppressed`, and `skipped`; they cannot persist `submitted`, `delivered`, `read`, `cancelled`, or `unknown`.
- Stored campaign counters can disagree with recipient/provider outcomes. Recent examples include 131 recipient rows on a campaign reporting 130 recipients, and a campaign marked `sent` with failed or pending recipients.
- Recent provider errors include 926 Meta 131049 outcomes, 489 email timeout reaps, 76 missing-template failures, 52 hourly-ceiling failures, plus 131026, 130472, 132001, and 132018 errors.
- Meta error policy is duplicated across the dispatcher, WhatsApp sender, two retry workers, campaign retry, broadcaster, and frontend labels, and those copies disagree.
- The WhatsApp webhook calls the monotonic `record_delivery_event` RPC, then performs an unconditional direct update that can regress `read`/`delivered` back to `sent`.
- `send-broadcast` treats dispatcher `queued` as recipient `sent`; this is especially inaccurate for queued email.
- The campaign reconciler ranks a successful send above a later failure, so a post-submit provider failure can still be counted as sent.
- `process-comm-retry-queue` converts six-hour `awaiting_confirmation` rows to `succeeded` without provider evidence.
- `reconcile-whatsapp-pending` can resend an unknown-outcome request after three minutes even if Meta accepted the original call before the response was lost.
- Two WhatsApp retry queues exist with different backoff and terminal-code rules; the inspected repository contains no producer for `whatsapp_send_queue`.
- `campaign_recipients` has duplicate `(campaign_id, status)` indexes and no uniqueness guarantee for one logical recipient per campaign.
- Audience preview counts phone-bearing recipients even for email campaigns; RCS is allowed by frontend types but excluded by the live campaign channel constraint.
- Several public communication functions use a service client without their own authorization gate. `dispatch-communication`, `send-whatsapp`, `send-email`, `send-rcs`, `reconcile-campaign-stats`, retry/reconcile workers, and webhook endpoints require explicit caller or signature hardening.
- `email-webhook` and `rcs-webhook` accept unsigned payloads; WhatsApp is fail-closed but one implementation still uses a non-constant-time comparison and logs full phone numbers.
- There is only one communications-focused test (`ig-comment-automation.test.ts`); no campaign lifecycle, retry, counter, template, or webhook regression suite exists.

## Dependency map

```text
CampaignWizard / CampaignsPanel / CampaignDetailDrawer
        │
        ├─ resolve_campaign_audience_v2
        ├─ campaigns
        └─ campaign_recipients
                 │ claim_broadcast_batch (SKIP LOCKED)
                 ▼
          send-broadcast
                 ▼
       dispatch-communication
          │      │      │      │
          WA    Email   SMS    RCS
          │      │      │      │
       provider acknowledgement / queues
          │      │      │      │
       authenticated webhooks and reconcilers
                 ▼
 communication_logs + communication_delivery_events
                 ▼
 campaign recipient state + atomic campaign rollup
                 ▼
 campaign detail/report + controlled retry
```

## Problem matrix

| Severity | Area / evidence | Root cause and impact | Minimal fix | Migration | UI | Tests |
|---|---|---|---|---|---|---|
| Critical | Public send/reconcile functions | Service-role clients are reachable without consistent in-function auth; unauthorized sending or state mutation is possible | Add shared service-or-authenticated-staff gate, branch capability check, and service-only gates for workers/reconcilers; migrate remaining client direct sends to the canonical dispatcher | No | No | Yes |
| Critical | Email/RCS webhook ingress | Unsigned callbacks can mutate delivery state | Verify provider signatures or a configured shared webhook secret; fail closed and retain forensic rejection logs | Possibly secret/config only | No | Yes |
| High | WhatsApp webhook status update | Direct updates bypass `record_delivery_event` monotonic rules; out-of-order callbacks regress state | Make the RPC authoritative, remove the raw status overwrite, and apply the same guarded transition to `whatsapp_messages` and linked campaign recipients | Yes | No | Yes |
| High | Campaign state/counters | API acceptance and queued email are recorded as `sent`; JavaScript workers race while updating stored counters | Extend states, persist provider acceptance as `submitted`, and recalculate all counters atomically from recipient rows | Yes | Yes | Yes |
| High | Reconciler | Highest “happy” rank wins over later provider failure; pending/suppressed/skipped are miscounted | Replace rank merge with latest authoritative delivery-event semantics and one database rollup RPC | Yes | Yes | Yes |
| High | Unknown outcomes | Six-hour rows are silently marked succeeded; pending sweeper can duplicate sends after an ambiguous timeout | Persist `unknown/reconciliation_required`; never blind-resend provider-ambiguous WhatsApp attempts | Yes | Yes | Yes |
| High | Error policy | Meta codes are classified differently in 5+ paths | Add one shared server policy module and persist `error_class`, code, retryability, and action; frontend reads persisted classification | Yes | Yes | Yes |
| High | Retry idempotency | Failed logs are deleted to reuse a dedupe key; queue dedupe is recipient/body based and increments attempts without a send | Keep immutable attempts, add logical-message/attempt linkage and one active queue row per original message | Yes | Yes | Yes |
| High | Chunk continuation | Self-fetch/setTimeout can be lost; multiple kicks can overlap; watchdog can close a campaign as sent without reconciling outcomes | Keep `SKIP LOCKED`, add a database lease/continuation token, re-check campaign state before each send, and let watchdog only reclaim expired work | Yes | No | Yes |
| High | Campaign control | No true cancellation state/RPC; pause is only partially enforced; retry can reset rows before dispatch is accepted | Add atomic pause/resume/cancel/retry RPCs with valid transitions and audit metadata | Yes | Yes | Yes |
| Medium | 131049 / 130472 | Eligibility blocks are mixed with failures and pacing speed; fallback can obscure the original WA outcome | Persist `marketing_status`, Meta code/time, optional configured block-until, route/template, and fallback result; no immediate retry and no normal retry-budget consumption | Yes | Yes | Yes |
| Medium | Template variables/media | Heuristic slot inference is powerful but untested; 132018 differs by worker; media fetch is unbounded | Validate the final provider component contract, centralize variable mapping, enforce media size/type/time limits, preserve filenames and native headers | No | Validation feedback only | Yes |
| Medium | Audience/channel compatibility | Email preview is phone-based; RCS frontend/schema disagree; source IDs can duplicate within campaigns | Resolve/dedupe by the selected channel address and enforce a logical-recipient uniqueness key | Yes | Yes | Yes |
| Medium | Email lifecycle | Queue acceptance is shown as sent and queue worker directly overwrites log state | Record `queued/submitted/sent` through the delivery-event RPC and correlate queue IDs to campaign recipients | Yes | Yes | Yes |
| Medium | RCS/SMS lifecycle | Direct status writes and provider-specific fallback logic bypass common policy in places | Route DLR changes through the same transition RPC; only run configured/category-approved fallback | No/Yes if metadata columns are added | Yes | Yes |
| Medium | Legacy direct paths | `send-reminders`, scan delivery, chat, and service helpers still invoke channel functions or write logs directly | Move each active caller to `dispatchCommunication`; retire only confirmed-unused legacy code after production reference checks | No | No | Yes |
| Medium | Retry Queue UI | UI queries obsolete statuses (`retrying`, `failed`) and can restart terminal errors indiscriminately | Display real states/classes; only enable retry when policy says retryable; invoke guarded RPCs instead of direct table updates | Yes | Yes | Yes |
| Low | Indexes/logging | Duplicate recipient index; missing provider-message/WhatsApp-message uniqueness; full phone values appear in logs | Remove only the duplicate index, add justified partial/unique indexes after duplicate audit, and mask logs to last four digits | Yes | No | Yes |

## Implementation phases

### 1. Database state machine and atomic rollups

Create one forward migration that:

- Adds `materializing` and `cancelled` campaign states and the required recipient states: `submitted`, `delivered`, `read`, `cancelled`, and `unknown`.
- Adds `pending_count`, `submitted_count`, `suppressed_count`, `cancelled_count`, and `unknown_count` to campaigns.
- Adds recipient trace/policy fields: `communication_log_id`, `provider_message_id`, `provider_route`, `template_id`, `last_meta_error_code`, `last_meta_error_at`, `error_class`, `next_retry_at`, `marketing_status`, `marketing_blocked_until`, and `fallback_reason`.
- Adds an immutable logical-recipient key and safe uniqueness/indexes for campaign claiming, retry due scans, provider IDs, and WhatsApp message IDs; remove only the confirmed duplicate index after auditing duplicate rows.
- Implements guarded RPCs for campaign materialize/claim/pause/resume/cancel/retry and `refresh_campaign_stats(campaign_id)`.
- Updates `record_delivery_event` so provider state transitions are monotonic, idempotent, and atomically propagated to the linked campaign recipient before counters are refreshed.
- Preserves existing rows with a non-destructive backfill; no communication history is deleted.
- Revokes public/anonymous execution and grants only the roles required by each RPC.

### 2. Central provider/error policy

Add a shared Edge Function policy module used by broadcaster, dispatcher, WhatsApp sender, and retry workers. It will classify:

- Permanent/data: 131026, 132000, 132001, 132012, 132018, 131051, 133010.
- Meta eligibility: 131049 and 130472; no immediate retry, no transient-budget use, controlled future eligibility only when configuration supplies it.
- Session/template routing: 131047; resolve an approved template once, then stop if unavailable.
- Transient infrastructure: network/fetch/timeouts, 429 and provider 5xx; exponential backoff with jitter and strict ceilings.
- Unknown: bounded cautious reconciliation, never blind replay after ambiguous provider acceptance.

Persist the classification and make frontend labels consume persisted fields rather than independently guessing from strings.

### 3. Dispatch and provider hardening

- Add Zod-compatible input validation and explicit authorization/branch checks to the canonical dispatcher.
- Preserve failed attempts; never delete a log merely to reuse its dedupe key. A retry receives a new attempt key linked to the original logical message.
- Return a structured result containing classification, retryability, log ID, provider route/message ID, template metadata, and acknowledgement state.
- Treat email queue acceptance and Meta HTTP acceptance as `queued/submitted`, not delivery.
- Bound media downloads by timeout, content type, and byte size before buffering.
- Permit WhatsApp → RCS/SMS fallback only when campaign policy, category, channel state, consent, and address all allow it; retain the original WhatsApp blocked/failure outcome separately.
- Migrate active direct-send/direct-log callers to the existing dispatcher; do not add a new messaging system.

### 4. Webhooks and reconciliation

- Make delivery webhooks idempotent and monotonic through `record_delivery_event`; remove secondary raw status overwrites.
- Add provider timestamp/event identity handling so duplicate or out-of-order callbacks cannot regress state or increment pacing breakers twice.
- Harden email/RCS webhook authentication and mask phone numbers in runtime logs.
- Change ambiguous WhatsApp timeout handling to `unknown/reconciliation_required`; only a definitive provider event or operator-approved fresh campaign can send again.
- Rebuild `reconcile-campaign-stats` around the atomic database rollup instead of JavaScript ranking.
- Change scheduled watchdog behavior so no-pending does not automatically mean sent; it must reconcile terminal recipient states first.

### 5. Retry consolidation and campaign controls

- Keep `communication_retry_queue` as the canonical retry queue.
- Verify live references to `whatsapp_send_queue`; disable/remove its worker only after confirming no producer or pending data.
- Add classification/retry reason and enforce one active retry per logical attempt with database uniqueness.
- Separate infrastructure retry count from delivery attempt count.
- Replace direct UI updates with guarded retry/restart/cancel RPCs that refuse terminal Meta/data errors unless an operator creates a new intentional attempt after correcting the cause.
- Implement atomic campaign cancellation and ensure every chunk re-checks `paused/cancelled` before provider submission.

### 6. Campaign UI compatibility, not redesign

Keep the existing drawers/cards and update their data contract to show accurate:

- Total, queued, dispatching, submitted, sent, delivered, read, failed, suppressed, retrying, Meta blocked, unknown, and cancelled counts.
- Recipient channel/template/attempt, Meta code, provider route, last error, next retry, and fallback result.
- Channel-aware audience counts and address skips.
- Action availability driven by server policy: retry retryable rows, resume paused/stalled work, cancel active work, and reconcile safely.

### 7. Regression and production verification

Add pure policy/state tests plus mocked function integration tests for all 30 requested scenarios, including 100/1,000-recipient campaigns, duplicate chunk claims, worker death, duplicate/out-of-order webhooks, every listed Meta code, timeouts/5xx/429, variable mapping, PDF/image/video, quiet hours, pause/resume/cancel, retry dedupe, fallback, and mixed-state completion.

Verification sequence:

1. Run focused unit and integration tests.
2. Run TypeScript/lint/build checks through the normal harness.
3. Run database linter and targeted schema/permission queries.
4. Invoke functions with authenticated/service test calls and mocked provider responses; consume all response bodies.
5. Run safe canary sends only to authorized test recipients—never send 100/1,000 real messages for a load test.
6. Replay duplicate and out-of-order webhook fixtures and verify database state/counters.
7. Use Playwright on the existing Campaign Wizard, detail/report drawer, pause/resume/cancel, and retry queue across desktop/mobile.
8. Reconcile recent affected campaigns after deployment and report before/after counts without deleting history.

## Delivery report

After implementation, provide the requested report: files changed, migrations, findings by severity, 131049 policy, retry/state/counter/webhook/template/security changes, tests and results, remaining risks, Meta-side configuration needs, and any production-data-dependent limitations.

## Technical constraints

- Preserve the current dispatcher, channel functions, UI structure, and good SKIP LOCKED/delivery-event logic.
- Use only forward migrations; no destructive data cleanup or old-migration rewrites.
- Keep credentials server-side and retain strict branch scoping.
- Do not classify Meta Marketing Messages API as a bypass for recipient eligibility restrictions.
