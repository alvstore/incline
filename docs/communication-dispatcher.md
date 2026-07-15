# Communication Dispatcher

Canonical outbound funnel. **All edge functions sending Email / SMS / WhatsApp / in-app messages MUST route through `dispatch-communication`.** Direct `INSERT INTO communication_logs` from any other edge function is blocked by the `Direct comm-log write guard` CI step.

## Why

- **Idempotency** — `dedupe_key` + partial unique index makes cron retries and webhook replays safe (no double-sends).
- **Preferences** — every send is gated by `should_send_communication(member_id, channel, category)` which honors channel kill switches, per-category opt-outs, and per-member quiet hours.
- **Telemetry** — `delivery_status` enum gains `suppressed` (preference block), `deduped` (already sent), `queued` (deferred for quiet hours), so System Health surfaces real funnel metrics.

## Contract

```ts
dispatchCommunication({
  branch_id: '...',
  channel: 'whatsapp' | 'sms' | 'email' | 'in_app',
  category: 'membership_reminder' | 'payment_receipt' | 'class_notification'
          | 'announcement' | 'low_stock' | 'new_lead' | 'payment_alert'
          | 'task_reminder' | 'retention_nudge' | 'review_request'
          | 'marketing' | 'transactional',
  recipient: string,                  // phone (+91...), email, or user_id
  member_id?: string,
  user_id?: string,
  template_id?: string,
  payload: { subject?, body, variables? },
  dedupe_key: string,                 // REQUIRED idempotency key
  ttl_seconds?: number,               // dedupe window, default 86400 (24h)
  force?: boolean,                    // bypass preferences (transactional only)
});
```

Returns `{ status, log_id?, reason?, provider_message_id? }` where `status` is one of `sent | queued | deduped | suppressed | failed`.

## Dedupe key conventions

| Origin                        | Key format                                                  |
|-------------------------------|-------------------------------------------------------------|
| Membership expiry reminder    | `membership-expiry:<member_id>:<due_date>:<channel>`        |
| Payment receipt               | `receipt:<payment_id>:<channel>`                            |
| Booking confirmation          | `booking-<event>:<booking_id>:<channel>`                    |
| Lead created notification     | `lead-created:<lead_id>:<channel>`                          |
| AI handoff to staff           | `handoff:<conversation_id>:<turn>:<channel>`                |
| Retention nudge               | `retention:<member_id>:<tier>:<YYYYMMDD>:<channel>`         |
| Google review request         | `greview:<visit_id>:<channel>`                              |
| Broadcast / campaign          | `broadcast:<campaign_id>:<member_id>:<channel>`             |

## Migration roadmap

The dispatcher is the new canonical path. Existing edge functions write to `communication_logs` directly; they are being migrated incrementally:

1. **New code MUST use the dispatcher** (enforced by CI).
2. **Wave A — done**: `request-google-review` (full refactor); `notify-booking-event` (removed redundant direct write).
3. **Wave B — pending**: `notify-lead-created`, `send-reminders`, `run-retention-nudges` — add stable dedupe keys per loop iteration.
4. **Wave C — pending**: `send-broadcast`, `notify-staff-handoff` — preserve campaign-level batching semantics.

The `skip_log: true` and `source_log_id` parameters on `send-whatsapp`, `send-sms`, `send-message` are reserved for the dispatcher to suppress double logging while it owns the canonical row.

## Quiet hours

Members configure `quiet_hours_start`, `quiet_hours_end`, and `timezone` in `member_communication_preferences`. Messages dispatched during quiet hours are inserted as `delivery_status='queued'` and pushed onto `communication_retry_queue` with `retry_after = now() + 1h`. The existing `process-comm-retry-queue` cron drains them.

`category='transactional'` and `channel='in_app'` always bypass quiet hours.

## Telemetry

`SystemHealth` page should surface:
- 24h `deduped` count (signals high cron-replay rate — investigate)
- 24h `suppressed` count (signals high opt-out rate — review templates)
- 24h `failed` count + recent `error_message` samples

## WhatsApp 131049 pacing — mitigation

Meta returns error `131049` ("This message was not delivered to maintain healthy ecosystem engagement") when the recipient's engagement score with your business is low OR your template's quality rating has dropped. Meta accepts the send (HTTP 200) but silently drops delivery. It is **not a code bug** — the dispatcher, template, and phone number are all valid.

The dispatcher and retry queue apply three product-level mitigations so the app stops making pacing worse:

1. **Retry suppression** — `process-whatsapp-retry-queue` treats `131049` (and `131026`, `131047`, `132000`, `132001`, `132015`, `132016`, `132018`) as terminal. Re-sending inside the pacing window tanks the template's quality further.
2. **24-h per-recipient cooldown** — before sending any `channel='whatsapp'` + `category='marketing'` message, the dispatcher checks `communication_logs` for a prior `131049` failure to the same `recipient` in the last 24 h. If found, the row is inserted as `delivery_status='suppressed'` with reason `pacing_cooldown_24h` and the provider call is skipped entirely.
3. **Operator guidance** — when pacing is repeatedly hit for a template, the operator should:
   - Rotate templates (Meta paces templates individually).
   - Use a warmer, opted-in audience (in-window WhatsApp contacts).
   - Prefer UTILITY over MARKETING category when the intent is truly transactional.
   - Fall back to **RCS** (Telinfy) or SMS for cold outreach — RCS is not subject to Meta pacing.

For emergency manual sends, the Campaign Wizard's "Emergency bulk send" panel exports the resolved audience in Telinfy's CSV format (`CountryCode | MSISDN | <var1> | <var2> | …`) so operators can upload the file directly in the Telinfy panel.
