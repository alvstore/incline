# WhatsApp Smart Delivery — Audit Findings and Fix Plan

## What the audit found (read-only trace: Wizard → send-broadcast → dispatch-communication → send-whatsapp → Meta → webhook → counters)

Much of the requested architecture already exists and must be preserved:

- `_shared/metaErrorPolicy.ts` already classifies Meta codes (131049/130472 = pacing, 131026/131047/132000/132001/133010 = terminal, 5xx/429 = retry) with a single backoff table.
- `_shared/deliveryState.ts` already enforces monotonic transitions and webhook precedence.
- `send-whatsapp` v2.8.0 already routes marketing templates through MM API when `config.mm_api_enabled = true` and returns `provider_route`.
- `campaign_recipients` already has `provider_route` and `marketing_blocked_until`.
- `src/lib/campaigns/deliveryStats.ts` is the shared counter model used by cards and drawer.

### Gaps (prioritised)

**P1 — pacing is decided by string matching, not recipient state.**
`dispatch-communication` (~line 919) detects cooldown with `error_message ilike '%131049%'` over recent logs; `send-broadcast` (~line 863) re-implements a regex; `whatsapp-webhook` (~line 519) has a third regex; `LiveFeed.tsx` has a fourth in the browser. Four independent definitions drift. There is no recipient-level marketing memory keyed by phone/member — only per-campaign-recipient `marketing_blocked_until`, so a member paced in campaign A is freely re-dialled by campaign B.

**P1 — pacing is reported as a generic failure.** Paced recipients land in `failed`, so campaign reports say "52 failed" when ~51 are Meta pacing, not delivery failures. No `pace_limited` state exists in the counter model.

**P1 — no message-purpose gate in the composer.** `CampaignWizard.tsx` hardcodes `category: 'marketing'` (line 831) and derives category loosely (line 632). Nothing prevents promotional free text being sent under a utility template, and nothing blocks sending on a stale/rejected template.

**P2 — "Retry failed (61)" retries every failed row,** including paced and terminal recipients (`retry-campaign-failed`), which is exactly the behaviour that worsens pacing.

**P2 — no preflight.** Recipients are silently dropped at dispatch time (DND, cooldown, invalid number); staff see the loss only after sending.

**P3 — conversation window is inferred, not exposed.** `whatsapp-context.ts` resolves provenance well (Meta context ID first), but there is no explicit `conversation_window_active/expires_at` surface for policy or UI.

## What will be built

### 1. One policy module (`supabase/functions/_shared/whatsappPolicy.ts`)
Wraps the existing `metaErrorPolicy` and becomes the only place that answers: message category, recipient eligibility (DND, opt-in, marketing cooldown, pace cooldown), retry eligibility, provider route, and conversation-window state. `dispatch-communication`, `send-broadcast`, `process-comm-retry-queue`, `retry-campaign-failed` and the webhook all call it; their local regexes and inline rules are deleted, not duplicated.

### 2. Recipient-level marketing memory (DB)
Add a `whatsapp_recipient_state` table keyed by normalised phone + branch: `last_marketing_attempt_at`, `last_marketing_delivered_at`, `last_marketing_read_at`, `last_reply_at`, `last_pace_limited_at`, `pace_events_30d`, `marketing_cooldown_until`. Written by the webhook and the senders; read by the policy module. Cooldown length is configurable in `settings` (default 24h, escalating on repeat pacing) — no hard-coded business rules in functions. RLS: staff read-only branch-scoped, service_role write.

### 3. `pace_limited` as a first-class state
Added to `deliveryState.ts`, `campaign_recipients.status`, and `deliveryStats.ts`. Cards, drawer and analytics show Recipients / Submitted / Delivered / Read / Failed / Pace limited / Suppressed / Pending / Unknown, all derived from recipient rows so counts reconcile. Pacing never counts as Failed and never triggers automatic retry.

### 4. Smart composer + preflight (`CampaignWizard.tsx`)
A purpose step (Marketing / Utility / Authentication / Service) filters the template picker to matching approved Meta categories and blocks stale, rejected or paused templates with "Template needs synchronisation/review". A preflight panel (new `campaign-preflight` RPC) shows Total / Eligible / DND / No consent / Recent marketing / Pace cooldown / Invalid number, with an authorised drill-down per exclusion reason, plus template category, provider route and expected queue duration. Marketing content cannot be relabelled utility.

### 5. Smart retry
`retry-campaign-failed` splits rows through the policy module into Retryable / Pace limited / Terminal and only retries the first group; the drawer button shows the same split before confirming.

### 6. Analytics
Failure breakdown groups by real Meta code with a plain-language explanation of what happened, what Incline did, whether retry is allowed and when re-evaluation is possible.

### 7. Conversation window + provenance
Webhook records the latest qualifying inbound interaction and exposes `conversation_window_active / started_at / expires_at`; the AI brain keeps receiving campaign provenance (already resolved via Meta context ID) so replies read as "responding to campaign X".

## Sequencing and verification
1. Policy module + DB migration (state table, `pace_limited`, settings keys) → typecheck, build, DB + RLS checks.
2. Senders/retry/webhook switched onto the policy module; local duplicates removed → Deno check, delivery-integrity tests.
3. Counters, analytics and retry UI.
4. Composer purpose step and preflight.
5. Test matrix in `_shared/deliveryIntegrity.test.ts` covering routing (MM API on/off, utility→Cloud), 131049 no-retry + cooldown, terminal codes, 5xx retry, unknown-after-timeout no duplicate, duplicate send/worker/webhook, monotonic state, DND, branch isolation, secret absence, provenance resolution and counter reconciliation.

## Guardrails
- No rewrite of the WhatsApp architecture; Meta Cloud API stays.
- No template rotation, category relabelling, provider hopping or any other attempt to bypass Meta pacing.
- No claim that 131049 disappears — the goal is to stop Incline-caused pacing, stop harmful retries and explain every outcome.
- No provider credential reaches the browser; existing edge auth, RLS and signature verification are re-checked, not loosened.
