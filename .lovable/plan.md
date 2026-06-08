## Audit findings

Pallavi’s thread shows three important signals:

- The first AI reply was sent as plain text containing a raw interactive JSON block instead of a real WhatsApp list.
- Pallavi then replied: `Weight loss and body maintained`.
- The AI provider did run successfully for that reply, but no outbound WhatsApp row was created afterward. The lead-loss monitor correctly flagged: `No AI reply within 5m`.

So this is not just an AI model issue. It is a send-pipeline reliability issue after the AI generates a response.

## Root-cause areas to fix

1. **Interactive payload normalization is incomplete**
   - The sender now recognizes Meta-native JSON, but canonical list payloads can still carry `body: { text: ... }` instead of `body: "..."`.
   - That can produce invalid Meta payloads or broken stored text.

2. **Post-AI send errors are not fully persisted**
   - If `sendAiReply()` throws before inserting the outbound message, the conversation appears dead: AI call succeeded, but chat has no reply row.
   - This matches Pallavi’s second inbound symptom.

3. **Send lock is too broad**
   - Current lock is phone-based, so close-together messages from the same lead can suppress a legitimate reply.
   - It should be keyed by inbound message id, not only by phone.

4. **Lead-loss monitor only alerts; it does not recover**
   - It detected Pallavi’s stuck inbound but intentionally did not send a safe recovery reply.
   - For live lead capture, alert-only is not enough.

5. **Free-text answers to interactive prompts need deterministic continuation**
   - Pallavi answered the goal in free text. The brain learned `fitness_goal=weight_loss`, but the system must always advance to plan-duration capture rather than relying only on the model.

## Implementation plan

### 1. Harden WhatsApp interactive sending
- Normalize both supported shapes before building Meta payloads:
  - Native Meta envelope: `{ type: "interactive", interactive: { type: "list", ... } }`
  - Canonical app shape: `{ type: "interactive_list", body: "..." | { text: "..." }, sections: [...] }`
- Always convert list/button body to a plain string.
- Store a clean human-readable fallback in `whatsapp_messages.content`, never raw JSON or `[object Object]`.
- Keep raw payload out of user-visible chat content.

### 2. Add no-silent-fail logging around the send path
- Split `runUnifiedAgent()` and `sendAiReply()` error handling so send failures are logged as send failures, not generic AI failures.
- If `sendAiReply()` fails before row insert, write a warning/error event with:
  - inbound message id
  - phone
  - branch
  - generated reply sample
  - failure stage
- This makes future System Health audits show the exact stop reason.

### 3. Scope send locks by inbound message
- Pass the inbound message id into `sendAiReply()`.
- Use a lock key like `ai_reply:<phone>:<inbound_message_id>`.
- This prevents duplicate webhook replays for the same inbound while allowing replies to separate messages from the same person.

### 4. Add deterministic lead-capture continuation
- After auto-learning captures `fitness_goal` and `plan_interest` is still missing, force the next reply to the membership-duration list.
- If `plan_interest` is captured, force the next reply to the correct Founding Member handoff/confirmation.
- This covers cases where the user replies in free text instead of tapping the list.

### 5. Upgrade the lead-loss monitor from alert-only to safe recovery
- For a stuck inbound older than the SLA with no outbound after it:
  - Acquire an idempotent recovery lock for that inbound message id.
  - Generate a deterministic next-step reply from memory.
  - Send it once through the same WhatsApp send path.
  - Log `recovered=true` in the error context.
- For Pallavi’s current state, the safe recovery reply should ask for membership duration, because name/email/goal are known and `plan_interest` is missing.

### 6. Validate with Pallavi’s exact scenario
- Test the exact raw JSON message shape from Pallavi’s chat.
- Test free-text goal reply: `Weight loss and body maintained`.
- Confirm:
  - outbound row is created
  - message type is `interactive` for lists
  - no raw JSON appears in chat content
  - lead-loss warning stops after recovery
  - System Health shows the incident as recoverable instead of unresolved

## Files expected to change

- `supabase/functions/whatsapp-webhook/index.ts`
- `supabase/functions/_shared/ai-agent-brain.ts`
- `supabase/functions/monitor-ai-lead-loss/index.ts`
- Possibly one small shared helper if needed to avoid duplicating deterministic recovery logic

## Expected outcome

A lead can no longer be left mid-conversation because of malformed interactive JSON, a send-path exception, a broad send lock, or a missed free-text answer to an interactive prompt.