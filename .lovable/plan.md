Root cause found: Instagram inbound is working, the AI auto-reply rows are being created, but they remain `pending` because `meta-webhook` still calls the old `/functions/v1/send-message` endpoint. That function no longer exists in this project, so the new `send-meta-dm` function is never reached. This matches the database rows for `IG · 344744`: inbound received, outbound pending, and zero `send-meta-dm` logs.

Plan:

1. Route AI Instagram replies through the new sender
   - Update `supabase/functions/meta-webhook/index.ts` so `triggerAiReply()` calls `send-meta-dm` for `instagram` and `messenger`.
   - Keep WhatsApp on `send-whatsapp`.
   - Check the HTTP response body and log delivery failures instead of silently ignoring them.

2. Fix other remaining Instagram outbound automation
   - Update `supabase/functions/lead-nurture-followup/index.ts` to call `send-meta-dm` instead of the removed `send-message` endpoint for Instagram/Messenger nurture messages.

3. Add backward compatibility for the old endpoint
   - Create a small `supabase/functions/send-message/index.ts` wrapper that routes:
     - `platform: instagram|messenger` → `send-meta-dm`
     - everything else → `send-whatsapp`
   - This prevents any older automation path from breaking again if it still calls `send-message`.

4. Deploy and verify
   - Deploy `send-meta-dm`, `send-message`, `meta-webhook`, and `lead-nurture-followup`.
   - Test `send-meta-dm` against the pending message for `IG · 344744`.
   - Confirm the message status changes from `pending` to `sent`, or capture the exact Meta error if credentials/window/permissions are the remaining issue.

Out of scope: profile picture/name fetching, UI header changes, and changing the AI reply content.