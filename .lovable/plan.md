## Audit finding

The duplicate Instagram replies are coming from two separate paths:

1. **Two inbound events in the same second**
   - The long PR/collaboration text and the attachment were stored as two inbound Instagram messages.
   - Each inbound message immediately triggered `triggerAiReply()`, so the bot replied once to the PR text and once to the attachment.

2. **Instagram echo webhook stores the bot’s sent message again**
   - `triggerAiReply()` first inserts an outbound row with `platform_message_id = null`.
   - Meta then sends the outbound echo with its real `mid`, and `meta-webhook` inserts another outbound row.
   - This makes the CRM show each bot response twice: one local pending/sent row + one echo row.

A third risk also exists: the AI send path has no per-inbound lock, so webhook retries or parallel shapes can still race.

## Plan

### 1. Add an Instagram AI reply idempotency lock
- Create a database function `claim_meta_ai_reply(...)` that atomically decides whether the bot is allowed to reply.
- It will block a second AI reply for the same Instagram/Messenger contact if:
  - the inbound message already has a reply marker, or
  - another inbound from the same contact triggered AI within a short burst window, or
  - the exact same non-fitness redirect was already sent recently.
- This prevents double DM replies even if Meta sends multiple webhook variants or an attachment follows the main text.

### 2. Fix outbound echo handling
- In `meta-webhook`, when an outbound echo arrives:
  - do not insert a second visible outbound row if a matching pending/sent local bot row exists within the last few minutes;
  - instead update that existing row with `platform_message_id` and `status = sent`.
- Add a partial unique index on `(platform, platform_message_id)` for non-null message IDs, since the audit confirmed there are currently no duplicates.

### 3. Gate AI replies before calling the brain
- Update `triggerAiReply()` in `supabase/functions/meta-webhook/index.ts`:
  - call the new claim function before `runUnifiedAgent()`;
  - skip silently when the claim says another reply is already in progress/recently sent;
  - after inserting the outbound bot row, link it back to the inbound message marker.

### 4. Make attachments and unsupported IG message types non-chatty
- For Instagram/Messenger, do not run the lead-capture AI on pure `[Attachment]`, image-only, story/media-only messages unless there is meaningful text.
- This keeps the human PR message redirect, but prevents the attachment from triggering “Hi there! What’s your name?”.

### 5. Improve non-fitness stop behavior
- The existing non-fitness guard already pauses bot/nurture, but because parallel events race, the second event can enter before the pause is visible.
- The new claim lock closes that race, so partnerships/media/collaboration messages receive only one redirect and then bot is paused.

### 6. Validate with live data/logs
- Query the same Instagram contact timeline after the change to verify one visible outbound per AI decision.
- Deploy/test `meta-webhook` if edge function changes are approved.

## Files to change

- `supabase/functions/meta-webhook/index.ts`
- New migration under `supabase/migrations/` for the idempotency RPC and unique message-id index

## Expected result

Instagram AI will send at most one DM reply per inbound burst, attachments will not trigger an extra onboarding question, and Meta echo events will update existing outbound rows instead of duplicating them in chat.