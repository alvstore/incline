
## What we observed

Two contacts (Gaurav +91 96603 12254 and Ravindra +91 80055 43139) sent inbound messages that the AI processed successfully — but no outbound message was ever sent.

Evidence from the database:

| Contact | Last inbound | `ai_call_logs` for that turn | Outbound in `whatsapp_messages` |
|---|---|---|---|
| Ravindra | "weight loss and body build" — 06:45:23 | `whatsapp_reply` status=`success` at 06:45:32 | **None after 06:26** |
| Gaurav | "Sure" — 07:11:34 | `whatsapp_reply` status=`success` at 07:11:44 | **None after 07:11:12** |

- `ai_memory` confirms the brain updated facts (Ravindra: `fitness_goal=weight_loss`; Gaurav: `plan_interest=Founding memberships`) — so the brain ran to completion.
- `whatsapp_send_locks` shows the **old** outbound's lock row, but no new lock row from the post-AI send attempt → `sendAiReply` either never reached `try_whatsapp_send_lock`, or returned before insertion.
- `whatsapp_chat_settings`: `bot_active=true`, `do_not_contact=false` for both — not paused.
- `error_logs` has zero WhatsApp/AI errors in the last 24h → the failure path is **silent**.

## Root-cause hypothesis

The brain (`_shared/ai-agent-brain.ts`) returned `{ skipped: true, skipReason: "no_reply_text" }` *after* a successful `ai_call_logs` row was written. This happens at line 735:

```
if (!replyText) return skip("no_reply_text");
```

The `callAI` call logs `status=success` as soon as the model responds with **any** payload — including a tool_call with no text, or a follow-up tool call whose content is empty. After tools resolve, the second `callAI` (lines 723-728) may return empty `content` and we silently fall through to `skip("no_reply_text")`. The webhook then returns early at lines 483-488 with only a `console.log`, never inserting an outbound row and never logging to `error_logs`.

Less likely but possible secondary causes (will be ruled out by the diagnostic step):
- `enforceOutboundInteractiveGuards` strips an interactive JSON without re-injecting plain text in an edge case.
- `getWhatsAppIntegration(branchId)` returns null inside `sendAiReply` (line 657-658) — would also silently `return;`.
- Tool-loop crashed inside `try/catch` (line 730) and `replyText` stayed at the pre-tool value (could be empty).

## Plan

### 1. Add observability (do this first — non-breaking)
Promote the four silent `return` paths into `error_logs` entries (severity=`warning`, source=`whatsapp_webhook`) with the inbound `message_id`, phone, branch and reason:

- `whatsapp-webhook/index.ts` → `triggerAiAutoReply`: when `result.skipped`, write a warning with `result.skipReason` (today it's only `console.log`).
- `whatsapp-webhook/index.ts` → `sendAiReply`: warning when send-lock denies, when `getWhatsAppIntegration` is null, and when `accessToken`/`phoneNumberId` missing.
- `_shared/ai-agent-brain.ts` → before `return skip("no_reply_text")` (line 735), log the raw `choice.message` payload + tool-call presence so we can see whether the model returned only a tool call or truly empty.

### 2. Fix the tool-loop empty-content fallback
In `ai-agent-brain.ts` lines 700-733, if the tool follow-up `callAI` returns empty content **and** there was no pre-tool text, generate a deterministic fallback based on the captured tool result (e.g. "Got it — give me one sec to wrap this up." or, for lead-capture tools, the canonical next-missing-field ask from the sanitizer's helpers). Never let the function reach `skip("no_reply_text")` for a user who actually sent a real message after onboarding has started.

### 3. Verify against the live cases
After deploy, ask the user to reply once more from each affected number and confirm:
- A new row appears in `whatsapp_messages` with `direction='outbound'`.
- A new row appears in `whatsapp_send_locks` for that phone.
- If `result.skipped` ever fires again, an `error_logs` row exists pinpointing the reason.

## Out of scope (not changing now)
- The send-lock RPC itself (v6.2.0 logic is correct).
- The Founder's-Phase sanitizer (cannot return empty by construction).
- The `whatsapp_chat_settings` schema and per-channel toggles.

## Files to touch
- `supabase/functions/whatsapp-webhook/index.ts` — diagnostics in `triggerAiAutoReply` and `sendAiReply`.
- `supabase/functions/_shared/ai-agent-brain.ts` — diagnostic before `skip("no_reply_text")` + tool-loop empty-content fallback.

No DB schema changes. No frontend changes.
