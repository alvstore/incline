# Delivery-Integrity Hardening — Phased Implementation

Implements the second-stage fixes in the exact order given. No redesign, no second messaging system, no second retry queue, smallest safe changes only.

## Phase 1 — Provider outcome safety (`reconcile-whatsapp-pending`)

Today the reaper re-POSTs to Meta for any outbound row still `pending` after 3 minutes with no `whatsapp_message_id`, and it marks anything older than 24h `failed`. Both convert an unknown outcome into an invented one.

Changes:
- Introduce an explicit `unknown` / `awaiting_confirmation` outcome on the WhatsApp message row plus `provider_attempted_at` and `provider_ack_state`, so "we never transmitted" is distinguishable from "we transmitted and lost the response".
- Only resend when the send path recorded that the request was never transmitted (pre-transmission abort / DNS / connect error). Post-transmission timeouts move to `unknown` and wait for webhook or provider evidence.
- Never write `succeeded` or `failed` from elapsed time alone. Aged unknowns stay `unknown` with `reconciliation_required` and surface in ops UI.
- Reconciliation becomes idempotent: a row already `unknown` is not re-attempted, and a webhook that has already resolved the row short-circuits reconciliation.

## Phase 2 — Monotonic delivery state

Canonical progression `pending → queued → dispatching → submitted → sent → delivered → read`, terminals `failed | suppressed | cancelled | skipped`, with `unknown` explicitly non-successful.

Changes:
- One authoritative database transition function (extend the existing delivery-event RPC — not a new one) that enforces rank, idempotency, and terminal rules for `communication_logs`, `whatsapp_messages`, and the linked campaign recipient in a single call.
- Remove the unconditional raw status write that currently runs after the RPC in `whatsapp-webhook`, so a late `sent` callback can never regress `delivered`/`read`.
- Add the missing states to the recipient/log constraints via forward migration.

## Phase 3 — Provider delivery overrides send snapshot

`reconcile-campaign-stats` currently ranks "sent" above a later "failed", so a post-ACK provider failure still counts as success.

Changes:
- Replace rank-merge with authoritative-latest semantics: the newest provider delivery event for a logical recipient decides the final state; the send-time snapshot is only a fallback when no provider event exists.
- Suppressed/skipped/cancelled/unknown are counted in their own buckets rather than folded into failed or sent.

## Phase 4 — Never fabricate success (`process-comm-retry-queue`)

Changes:
- Delete the six-hour `awaiting_confirmation → succeeded` conversion.
- Aged rows become `unknown` and require provider evidence (webhook or DLR) to become `sent`/`delivered`, or explicit provider failure to become `failed`.

## Phase 5 — Queued vs sent (`send-broadcast`)

Changes:
- Dispatcher `queued` maps to recipient `queued`; dispatcher provider-accepted maps to `submitted`. `sent` only on provider ACK/event per the Phase 2 semantics.
- Stop optimistic counter bumps at chunk time; counters are recomputed from rows (Phase 6).

## Phase 6 — Database source of truth

Changes:
- `refresh_campaign_stats(campaign_id)` recomputes total/pending/queued/dispatching/submitted/sent/delivered/read/failed/suppressed/skipped/cancelled/unknown from `campaign_recipients` in one statement; stored counters become a reconciled cache, never independently incremented.
- Add the missing counter columns and a logical-recipient uniqueness key so 131 rows can never report 130; audit existing duplicates before adding the constraint and keep all production rows.
- Drop only the confirmed duplicate `(campaign_id, status)` index; add justified partial indexes for claim, retry-due and provider-id lookups.

## Phase 7 — Centralize Meta error policy

One shared Edge module (`supabase/functions/_shared/metaErrorPolicy.ts`) consumed by `send-whatsapp`, `dispatch-communication`, `send-broadcast`, both retry workers, campaign retry and reconciliation; the frontend reads the persisted classification instead of re-parsing strings.

Each code returns: `retryable`, `terminal`, `cooldown`, `fallback_allowed`, `affects_sender_health`, `affects_campaign_pause`, `operator_action_required`. Covers 131049, 130472, 131026, 131047, 132000, 132001, 132012, 132018, 131051, 133010, HTTP 5xx, network, timeout, unknown. No invented Meta behavior — cooldowns come from configuration, not guesses.

## Phase 8 — Consolidate retry decisions

`communication_retry_queue` stays the single queue. Any remaining worker calls the same shared policy — no private terminal lists, no private backoff. Concurrency is guaranteed by dedupe key + attempt count + `next_retry_at` + a processing lock/state so two workers cannot retry one logical recipient. The legacy WhatsApp queue worker is retired only after confirming it has no producer and no pending rows.

## Phase 9 — 131049 handling

Treated as a Meta recipient-level marketing eligibility/pacing outcome: no immediate retry, no transient-budget consumption, no repeat sends during cooldown. Persist `last_meta_error_code`, `last_meta_error_at`, `marketing_blocked_until` on the recipient. 131049 never marks a campaign failed; pause logic switches to error-ratio + classification thresholds.

## Phase 10 — Regression tests

Deno tests covering all 20 listed scenarios: accepted-but-lost, rejected, duplicate webhook, out-of-order webhook, READ→SENT, DELIVERED→SENT, success-then-provider-failure, awaiting-confirmation timeout, queued email, 131049, 130472, 131026, 132001, 132018, duplicate retry worker, duplicate chunk, cancellation, pause/resume, completion, and the 131-vs-130 count mismatch.

Verification: run the Deno tests, typecheck/lint/build, database linter, and targeted schema/counter queries; reconcile recently affected campaigns and report before/after counts. No bulk canary sends to real recipients.

## Technical notes

- Forward migrations only; no destructive cleanup, no rewriting old migrations.
- Existing dispatcher, channel functions, SKIP LOCKED claiming and delivery-event RPC are preserved and extended.
- Delivery is never claimed without provider evidence, and never inferred from elapsed time or a returned API call.

## Final report will include

Files changed, migrations created, tests added, tests executed with results, remaining failures, anything requiring manual Meta Business Manager configuration, and residual risks.
