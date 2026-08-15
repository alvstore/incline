# Messaging Audit and WhatsApp Meta Visibility Fix

Audit and address notification noise (registration OTPs in staff notifications) and ensure all outgoing WhatsApp messages appear in the Meta Business Suite chat.

## User Requirements
- **Notification Noise:** Stop "registration OTP" messages from appearing in the staff notification hub (in-app notifications). These are for the member, not for human assistance.
- **WhatsApp Meta Visibility:** Ensure all outbound messages sent by the AI/CRM appear as outgoing messages in the Meta Business Suite. Currently, only inbound messages show up there.

## Technical Details

### 1. Notification Noise Fix
The current logic in `notify-staff-handoff` creates an in-app notification every time a handoff or assistance event is triggered. However, the user reports that registration OTP triggers are landing here.
- **Root Cause:** In-app notifications for "human assistance" are being created for every handoff request, including automated registration flows that might be misclassified or unnecessarily alerting staff.
- **Action:** 
    - Modify `supabase/functions/notify-staff-handoff/index.ts` to skip creating in-app `notifications` rows if the `reason` is clearly automated (like `registration_otp` or `otp_trigger`).
    - Add a `skip_notification` flag to the handoff request payload to allow callers to suppress in-app alerts.

### 2. WhatsApp Meta Visibility Fix
Outbound messages sent via the WhatsApp Cloud API (used by `send-whatsapp`) normally appear in Meta Business Suite *if* they are associated with the WABA and the specific phone number. 
- **Root Cause:** When the system sends a message via the API, Meta tracks it. If it's not showing as "outgoing" in Meta Business Suite, it's often because:
    1. The message is being sent as a "freeform" message without a template to a number outside the 24h window (though these would usually fail).
    2. The message is sent through a different API path (MM API vs Cloud API) that doesn't sync back to the Meta UI.
    3. The `whatsapp_messages` direction/status is not being updated correctly in a way that the Meta callback listener expects.
- **Discovery:** `dispatch-communication` routes marketing messages through `mm_api` when enabled. MM API (Telinfy/Smartping) might not sync outgoing messages back to the Meta Business Suite chat view.
- **Action:** 
    - Audit `send-whatsapp` and `dispatch-communication` to ensure the `messaging_product: "whatsapp"` and correct API versions are used.
    - For `mm_api` (Telinfy) sends, outgoing messages generally *do not* show up in Meta Business Suite because they bypass Meta's direct Cloud API integration for the UI. I will verify if we can switch to Cloud API for all outbound to ensure visibility, or at least document the limitation.
    - Check if `whatsapp-webhook` is correctly processing `echo` events for outgoing messages. Outbound messages sent via API generate an echo webhook. If ignored, the system might not link them correctly.

### 3. Identity Resolution Audit
Ensure the AI greets members by name and doesn't treat them as new leads.
- **Action:** Re-verify `ai-agent-brain.ts` and `ai-prompt.ts` to ensure `resolveMemberContext` is robust and the prompt strictly enforces the `MEMBER SELF-SERVICE PROTOCOL`.

## Files to Modify
- `supabase/functions/notify-staff-handoff/index.ts`: Add `skip_notification` logic.
- `supabase/functions/dispatch-communication/index.ts`: Audit `mm_api` usage and ensure Cloud API is preferred for non-broadcasts.
- `supabase/functions/whatsapp-webhook/index.ts`: Ensure `echo` events are handled to reflect outbound state.
- `supabase/functions/_shared/ai-agent-brain.ts`: Refine handoff reasons to allow notification suppression.
