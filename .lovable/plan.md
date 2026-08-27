# WhatsApp Conversation Context & Message Provenance Layer

One WhatsApp number stays. We add a provenance + context resolution layer between the inbound webhook and the AI brain so replies to announcements/campaigns are understood as such instead of being treated as brand-new conversations.

## 1. Current architecture findings (verified)

- `whatsapp-webhook/index.ts` (v6.6.0): verifies signature → `processIncomingMessages` inserts every message into `whatsapp_messages` (dedupe on `whatsapp_message_id`) → for inbound rows only, calls `triggerAiAutoReply`. Outbound echoes are correctly skipped (line 228).
- `triggerAiAutoReply` loads `phone_number, contact_name, content, created_at`, runs the opt-out detector, then calls `runUnifiedAgent` with only `{senderId, branchId, platform, messageId, messageContent, contactName, messageType}`. **No outbound history, no campaign linkage is passed.**
- `runUnifiedAgent` (`_shared/ai-agent-brain.ts`) resolves member/lead/unknown identity itself and pushes `dynamicSegments` into `buildSystemPrompt({ identity, dynamicContext })`, rendered as `<runtime>` by `_shared/ai-prompt.ts`. Bot pause / handoff is read from `whatsapp_chat_settings.bot_active` + `bot_paused_until`. There is no notion of "why did this person message us".
- Outbound campaign persistence today: `send-broadcast` → `dispatch-communication` inserts an outbound `whatsapp_messages` row whose only linkage is `media_meta.source_log_id` (→ `communication_logs.id`), plus `communication_logs.dedupe_key` shaped `campaign:<campaign_id>:<source_type>:<source_ref_id>` and `campaign_recipients.communication_log_id` / `provider_message_id`.
- So the campaign is reachable from an outbound message today only via a fragile 3-hop chain through a JSONB field and a parsed dedupe key. Nothing reads that chain on inbound.
- Meta's inbound `message.context.id` (the quoted-message ID, which Meta sets when a user replies to a specific message) is currently **not read at all** by the webhook.
- `whatsapp_messages` has no `source_type`, `campaign_id`, `communication_log_id`, or `reply_to` columns. `whatsapp_chat_settings` has handoff/pause/DNC/summary fields but no conversation-context fields. `whatsapp_conversation_state` holds only lead-capture progress and repeat-question tracking.

## 2. Root cause

Provenance of the last outbound message is not persisted in a first-class, queryable way, and the inbound path never resolves conversation context before invoking the AI. `runUnifiedAgent` therefore sees `"Yes"` / `"Thanks ❤️"` as a cold inbound and falls back to its default lead/member objective — restarting onboarding or replying with something irrelevant.

## 3. Proposed architecture

New shared module `supabase/functions/_shared/whatsapp-context.ts` exporting `resolveConversationContext()`, called by both `whatsapp-webhook` and `meta-webhook` **before** the AI. It returns `{ contactType, conversationContext, sourceType, campaignId, campaignRecipientId, communicationLogId, originalMessageId, originalOutboundMessage, eventMeta, correlationMethod, correlationConfidence, shouldInvokeAI, noReplyReason, contextExpiresAt }`.

```text
inbound row inserted (with reply_to_message_id = Meta message.context.id)
   → resolveConversationContext()
       identity (member / lead / staff / unknown)
       handoff + pause + DNC state
       PRIMARY: message.context.id -> whatsapp_messages.whatsapp_message_id (exact)
       then:    stored provenance columns on that outbound row
       fallback: most recent outbound row in window (low confidence)
       -> source_type, campaign_id, campaign_recipient_id, communication_log_id
       -> campaign row (campaign_type, event_meta, message)
       -> context decision + expiry
   → gate: human_handoff / dnc / no_reply -> skip (logged)
   → runUnifiedAgent(ctx + conversationContext)
       -> <CURRENT_CONVERSATION_CONTEXT> injected via dynamicContext -> <runtime>
```

### Correlation priority

Meta `message.context.id` is the **primary** signal, never text similarity or keywords:

1. `meta_context_id` — exact provider-ID match against a stored outbound row → confidence `exact`.
2. `stored_relationship` — provenance columns on that row (campaign / log / recipient) → `exact`.
3. `recent_outbound` — most recent outbound in the context window → confidence `low`, used only when 1 and 2 yield nothing and only if a single unambiguous candidate exists.

### Context priority (validated against existing gates)

1. `bot_active=false` / `bot_paused_until` / `founder_handoff_task_id` → `human`, AI never runs (already exists in the brain; hoisted into the resolver so it is logged uniformly).
2. Do-not-contact / opt-out → existing detector, unchanged.
3. `transactional` — correlated outbound was a payment/membership/booking message.
4. `campaign_reply` — correlated outbound had `source_type='campaign'`.
5. `member_support` — contact resolves to a member, no correlation.
6. `lead` — existing lead flow (unchanged behaviour).
7. `unknown` — new contact (unchanged behaviour).


### Context transition (F)

Context lives on the thread with an expiry (`context_expires_at`, default 24h for campaigns, 72h for transactional). Every inbound re-runs the resolver; if the new message carries a clear unrelated intent (freeze/dues/booking/etc., detected by the existing intent regexes plus the AI's own returned context tag), the thread context is downgraded to `member_support` and the campaign context is cleared. Campaign context never persists beyond expiry or beyond a resolved transition.

### Deterministic vs AI (G)

Deterministic pre-LLM only for unambiguous, single-token confirmations against a campaign that declares an RSVP intent in `campaigns.event_meta` (`YES`/`Y`/`HAAN`/`NO`) → log RSVP + short scripted ack. Pure-reaction/gratitude messages (`❤️`, `👍`, `🙏`, `thanks`, `ok`) map to a **no-reply candidate**, not an automatic skip. Everything else (timings, "can I bring a friend", "can I come at 7") goes to the LLM with campaign context.

### No-reply design (E)

`AgentResult` gains `noReply?: boolean` and `contextTag?: string`. The model is instructed, inside `<CURRENT_CONVERSATION_CONTEXT>`, that it may return `{"no_reply": true}` when a reply would add no value. Deterministic reaction detection only *suggests* no-reply; if the thread has an open question or an unanswered transactional ask, the AI still replies. All no-reply decisions are logged with the reason.

## 4. Database changes (minimum, no duplication)

`whatsapp_messages` (promote from JSONB to real columns, backfilled from `media_meta.source_log_id` + dedupe key parsing):
- `source_type text` — `ai | human | campaign | automation | transactional | system | inbound`
- `communication_log_id uuid` (FK `communication_logs`)
- `campaign_id uuid` (FK `campaigns`), `campaign_recipient_id uuid` (FK `campaign_recipients`)
- `reply_to_whatsapp_message_id text` — Meta quoted-message ID for inbound
- indexes: `(branch_id, phone_number, direction, created_at desc)`, `(whatsapp_message_id)`, partial index on `campaign_id`

`whatsapp_chat_settings` (thread-level context, avoids a new table):
- `conversation_context text`, `context_ref_type text`, `context_ref_id uuid`
- `context_set_at timestamptz`, `context_expires_at timestamptz`

Not adding: a separate context table, a duplicate of campaign message text, or per-message context columns — the message rows already carry provenance and the thread carries the live context.

Grants/RLS follow existing patterns on both tables (no new tables, so existing policies apply; new columns inherit them).

## 5. Files to modify

| File | Change |
|---|---|
| `supabase/functions/_shared/conversation-context.ts` | **new** — resolver, priority ladder, no-reply heuristics, structured log emit |
| `supabase/functions/whatsapp-webhook/index.ts` | capture `message.context.id`; stamp `source_type='inbound'`; call resolver before `runUnifiedAgent`; pass context; honour `noReply`; stamp `source_type='ai'` on `sendAiReply` rows |
| `supabase/functions/meta-webhook/index.ts` | same resolver call for IG/Messenger (campaign correlation typically null) |
| `supabase/functions/dispatch-communication/index.ts` | write `source_type`, `communication_log_id`, `campaign_id`, `campaign_recipient_id` on the outbound `whatsapp_messages` insert (keep `media_meta` for back-compat) |
| `supabase/functions/send-broadcast/index.ts` | pass `campaign_id` / recipient id into the dispatch input so the dispatcher can stamp them |
| `supabase/functions/_shared/ai-agent-brain.ts` | accept `conversationContext` on `AgentContext`; render `<CURRENT_CONVERSATION_CONTEXT>`; skip its own identity re-resolution when supplied; return `noReply`/`contextTag` |
| `supabase/functions/_shared/ai-prompt.ts` | no signature change — block rides in `dynamicContext` → `<runtime>` |
| migration | columns + indexes + backfill above |

No frontend change is required; `src/services/campaignService.ts` needs no edit (campaign type/event meta already persisted on `campaigns`).

## 6. Race conditions (M)

- **Reply before provenance is stamped:** provenance is written on the same insert as the outbound row (pre-send), not after the provider ACK, so an instant reply always finds it.
- **Echo arriving before/after our own insert:** echo dedupe stays on `whatsapp_message_id`; the resolver ignores rows with `source_type='ai'` created within the current turn's lock window.
- **Delivery callback before log finalisation:** unchanged path; provenance columns are independent of delivery status.
- **Duplicate webhooks / duplicate inbound:** existing `whatsapp_message_id` uniqueness plus the existing `sendAiReply` send-lock; the resolver is pure-read and idempotent, and context writes to `whatsapp_chat_settings` are last-write-wins upserts keyed `(branch_id, phone_number)`.
- **Two campaigns close together:** quoted-message correlation first; otherwise the most recent outbound campaign row wins, and both campaign IDs are logged.

## 7. Observability (L)

One structured `log_error_event` (`source='whatsapp_context'`, severity `info`) per inbound carrying: branch, phone hash/last4, contact type, resolved context, campaign id, correlation method (`quoted` | `recent` | `none`), decision (`ai_invoked` | `skipped_handoff` | `skipped_no_reply` | `deterministic`), and latency. No message bodies logged.

## 8. Test plan (N)

Deno unit tests for the resolver covering the 15 listed scenarios (campaign→YES / thanks-emoji / "what time?" / "can I bring a friend" / unrelated question, lead flow, member question, handoff, AI echo, duplicate webhook, expired context, context transition, two close campaigns, transactional reply, unknown contact), plus a staging end-to-end: send a one-recipient campaign to a test number, reply with each of "YES", "❤️", "What time?", then "How do I freeze my membership?" and assert the resolved context and reply per step.

## 9. Rollout

1. Migration (columns + indexes + backfill) — additive, zero downtime.
2. Deploy dispatcher/broadcast provenance stamping. Verify new campaign sends populate the columns.
3. Deploy resolver + webhook wiring behind a flag in `ai_purposes.guards.conversation_context_enabled` (default off) → enable for one branch → enable globally.
4. No-reply gate enabled last, after a day of shadow logging where the decision is logged but a reply is still sent.

Rollback: flip the guard flag off; the columns stay and are harmless.

## 10. Risks & assumptions

- Assumes Meta populates `context.id` on quoted replies only — most campaign replies are unquoted, so recency correlation carries the load; the 24h window is a heuristic and is configurable.
- Backfill of historical `campaign_id` relies on parsing `communication_logs.dedupe_key`; rows that predate the campaign dedupe convention stay null (acceptable).
- The brain is large (3k lines); the change is additive to keep the shared IG/Messenger path intact.
- Deterministic RSVP handling depends on campaigns declaring intent in `event_meta`; without it, everything falls through to the LLM (safe default).
