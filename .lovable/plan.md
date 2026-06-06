# Why every message is stuck on "Sent"

## Root cause (deep scan results)

The Live Feed's delivery rail (Queued → Sent → Delivered → Read → Replied) reads from two places:

1. `communication_delivery_events` (per-stage event rows)
2. Fallback: `communication_logs.delivery_status` + `delivery_metadata`

**Nothing in the codebase ever inserts a row into `communication_delivery_events`** (confirmed via `rg` — only the UI reads it; no edge fn, trigger, or migration writes it). So the UI always falls back to the log row's `delivery_status`.

And `delivery_status` is the enum `reminder_delivery_status` whose values are only:
```
scheduled, sending, sent, failed, skipped, suppressed, deduped, queued
```
`delivered` and `read` are **not valid enum values**. Confirmed:
```
ERROR: invalid input value for enum reminder_delivery_status: "delivered"
```
So even when providers send delivered/read callbacks, the log can never advance past `sent`.

### Per-channel state today

| Channel | Provider callback received? | What we do with it | Result in UI |
|---|---|---|---|
| **WhatsApp** | ✅ Meta posts `statuses[]` (sent/delivered/read/failed) into `whatsapp-webhook` | Updates `whatsapp_messages.status` correctly. For `communication_logs` only stashes `wa_status` inside `delivery_metadata` JSON; never promotes to `delivery_status`; never inserts a delivery_event. | Stuck at Sent |
| **Email** | ❌ No Resend/SES webhook function exists (`ls supabase/functions` has no email webhook). `send-email` writes `delivery_status='sent'` once. | No delivered/opened/bounced ingestion at all. | Stuck at Sent |
| **SMS** | ❌ `send-sms` calls RoundSMS `dlr_endpoint` but **only at send time** to register DLR — there is no inbound webhook handler that ingests the DLR pings. | Provider has no URL to call back into. | Stuck at Sent |
| **RCS** | ✅ `rcs-webhook` exists and tries to write `delivery_status='delivered' / 'read'` directly — but the enum **rejects** those values, so the update silently fails. Also writes to wrong column `error_message` (column is `error_message` here, OK) but `delivered_at` / `read_at` don't exist on `communication_logs`. | Stuck at Sent + silent enum errors |

`communication_logs` schema confirms there are **no `delivered_at` / `read_at` / `replied_at` timestamp columns** either — so even fixing the enum wouldn't give us per-stage timestamps.

---

# The plan

A single, channel-agnostic delivery-lifecycle pipeline. Four parts.

## 1. Schema — extend `communication_logs` and the enum (one migration)

- Add enum values to `reminder_delivery_status`: `delivered`, `read`, `replied`, `bounced`, `clicked` (`ALTER TYPE … ADD VALUE`).
- Add nullable timestamp columns: `delivered_at`, `read_at`, `replied_at`, `failed_at`, `bounced_at`.
- Keep `delivery_metadata` JSONB for provider raw payloads.
- Backfill: no destructive change to existing rows.

## 2. Single helper: `record_delivery_event` RPC

A SECURITY DEFINER SQL function `public.record_delivery_event(p_log_id uuid, p_new_status text, p_provider text, p_provider_message_id text, p_error text, p_metadata jsonb)` that:

- Inserts a row into `communication_delivery_events` (channel / branch derived from the log).
- Monotonically advances `communication_logs.delivery_status` (never downgrade — e.g. don't overwrite `read` with `delivered`).
- Stamps the matching `*_at` column.
- Merges `metadata` into `delivery_metadata`.
- Idempotent on `(communication_log_id, new_status)` so repeated webhook pings are no-ops.

This becomes the **only** path the UI rail depends on.

## 3. Wire the four channels into the helper

### WhatsApp — `whatsapp-webhook/index.ts`
- In `processStatusUpdates`, after looking up the log by `provider_message_id=wamid`, call `record_delivery_event` for every `sent | delivered | read | failed` callback Meta sends.
- Keep the existing `whatsapp_messages.status` update (CRM inbox).

### Email — new `email-webhook` edge function (public, no JWT)
- Accepts Resend webhook events (`email.delivered`, `email.bounced`, `email.opened`, `email.complained`, `email.clicked`).
- Looks up log by `provider_message_id` (the Resend id we already store) and calls `record_delivery_event`.
- Add the webhook URL to the Resend dashboard secret/config (one-time setup note in the response).

### SMS — new `sms-webhook` edge function
- Accepts RoundSMS DLR POSTs.
- Look up log by `provider_message_id` (= `batch_id` we already capture) and call `record_delivery_event`.
- Update `send-sms` to set `dlr_endpoint` to point at this new function URL on send.

### RCS — fix `rcs-webhook/index.ts`
- Replace the direct `communication_logs.update({ delivery_status: 'delivered' … })` with a call to `record_delivery_event` (this also fixes the silent enum failure).

## 4. UI — `DeliveryTimeline.tsx`

- No structural change to the rail (already supports 5 stages).
- Remove the "synthesize from log" fallback once events are flowing — keep it only for legacy rows older than the migration date so old chats still render reasonably.
- Add per-channel capability hints: SMS providers that don't support read receipts collapse `Read` to a muted state with an "N/A for SMS" tooltip instead of leaving it falsely "pending".

---

# Out of scope (will note, not build)

- In-App notification "read" tracking already exists separately via `notification_reads` — not unified here.
- Email "clicked" link tracking requires Resend's tracking pixel — included in mapping but does not affect the rail (only metadata).
- Backfilling historical stuck rows: keep them as-is (UI fallback still renders); future sends start clean.

# Files touched

- `supabase/migrations/<new>.sql` — enum + columns + `record_delivery_event` RPC.
- `supabase/functions/whatsapp-webhook/index.ts` — call helper in `processStatusUpdates`.
- `supabase/functions/rcs-webhook/index.ts` — call helper instead of direct update.
- `supabase/functions/send-sms/index.ts` — point `dlr_endpoint` at new webhook.
- `supabase/functions/sms-webhook/index.ts` — **new**.
- `supabase/functions/email-webhook/index.ts` — **new**.
- `src/components/communications/DeliveryTimeline.tsx` — minor: SMS "N/A for read" + retire synthesize once events exist.

Approve and I'll implement.
