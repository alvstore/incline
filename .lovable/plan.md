## What you're seeing

The 11:54 "What's your main fitness goal, ravindra?" and 11:44 "Hi there! I'd be happy to help…" messages show a clock icon as if never sent. They actually **were sent successfully** — but a duplicate ghost row is left behind in `failed` state, and the UI mistakenly renders any non-`sent/delivered/read` status as a clock.

## Root cause

1. **Backend race** — `supabase/functions/whatsapp-webhook/index.ts` (`sendAiReply`) inserts the outbound `whatsapp_messages` row **before** acquiring the send-lock. Meta frequently re-delivers the same inbound webhook within seconds, so two parallel runs both insert rows; one wins the lock and sends, the other marks **its own row** as `failed` with reason `"duplicate suppressed (send-lock held)"`. DB confirms this:
   - `4ddfa76b…` failed @ 11:54 → real delivered twin `0e3999cd…` @ 11:56
   - `e1d5cb0d…` failed @ 11:44 → real delivered twin `4e0a62f1…` (Vishal reply)

2. **Frontend status mapping** — `src/pages/WhatsAppChat.tsx` `getStatusIcon` returns a `Clock` icon for `default:` (any non-sent/delivered/read), so `failed` and `pending` both look identical and "stuck".

## Fix

### Backend — `supabase/functions/whatsapp-webhook/index.ts`
- In `sendAiReply`, acquire `try_whatsapp_send_lock` **before** inserting the outbound row.
- If the lock is not acquired, return early without inserting anything (the parallel winner handles it). No more ghost `failed` rows.
- Bump header version comment.

### Frontend — `src/pages/WhatsAppChat.tsx`
- Update `getStatusIcon`:
  - `failed` → red `AlertTriangle` (visibly different from pending) with `title="Failed to send"`.
  - `pending` / `queued` / unknown → `Clock`.
- Optional small polish: when status is `failed`, render the time row with a subtle red tint so the user can tell at a glance.

### Cleanup
- One-off SQL to soft-clear the existing two ghost rows so the user's current chat history looks right:
  ```sql
  UPDATE whatsapp_messages SET status='delivered'
   WHERE failure_reason='duplicate suppressed (send-lock held)'
     AND status='failed' AND created_at > now() - interval '1 day';
  ```
  (Run as a migration so the timeline cleans up immediately.)

## Scope (kept narrow)
- 1 edge function edit (whatsapp-webhook)
- 1 component edit (status icon mapping in WhatsAppChat.tsx)
- 1 cleanup migration

No DB schema changes, no behavior changes to send-meta-dm (its lock-then-update pattern already inserts before locking but produces the same ghost — out of scope unless you want me to apply the same fix there too).

Want me to include `send-meta-dm` in the same wave?