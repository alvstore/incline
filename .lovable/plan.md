# Outbound Instagram DMs not being sent

## Root cause

The chat composer in `src/pages/WhatsAppChat.tsx` (lines 471–479) always invokes the **`send-whatsapp`** edge function regardless of the conversation's `platform`. That function (`supabase/functions/send-whatsapp/index.ts`):

1. Loads only `integration_type = "whatsapp"` integrations.
2. Calls Meta's **WhatsApp Cloud API** (`META_API_BASE/{phone_number_id}/messages`).
3. Runs `normalizePhoneDigits()` which **returns `null` for any string longer than 15 digits** (line 85).

An Instagram-Scoped ID like `1466606398344744` is **16 digits** → normalize returns `null` → 400 "Invalid recipient phone number". Even if the IGSID were ≤15 digits, the call would still hit the wrong Graph endpoint with the wrong token.

That's why inbound IG DMs arrive (handled by `meta-webhook`) but nothing goes out for `IG · 344744`.

There IS a working IG send pattern already in `supabase/functions/process-ig-comment-runs/index.ts` (`sendIgPrivateReply`) and the right integration loader (`loadIntegration` picks `instagram` / `instagram_login` / `meta` / `facebook_page`). We will reuse the same pattern.

## Scope

Add outbound Instagram (and Messenger) DM dispatch from the unified inbox composer. Backend-only fix + a tiny client routing change. No UI redesign.

## Changes

### 1. New edge function: `supabase/functions/send-meta-dm/index.ts`

- Inputs: `{ message_id, platform: 'instagram' | 'messenger', recipient_id (IGSID/PSID), content, branch_id }`.
- Loads the right integration via the same logic as `process-ig-comment-runs.loadIntegration` (IG-native first → fallback to FB Page).
- Resolves the **business account id** to call (`igAccountId` for IG; FB Page id for Messenger).
- POSTs to `https://graph.facebook.com/{version}/{accountId}/messages` with body `{ recipient: { id }, message: { text }, messaging_type: 'RESPONSE' }` and `Authorization: Bearer <page_access_token | access_token>`.
- On success → updates `whatsapp_messages.status = 'sent'` and stores returned `message_id` if any. On failure → marks `status='failed'`, writes to `log_error_event` with the Meta error message, and returns 4xx/5xx.
- Standard CORS + try/catch wrapper + `// v1.0.0` header comment, per project edge standards.

### 2. Client: route by platform in `src/pages/WhatsAppChat.tsx` `sendMessage` (around line 472)

Replace the unconditional `send-whatsapp` invoke with:

```ts
const isMeta = selectedContact.platform === 'instagram' || selectedContact.platform === 'messenger';
const fn = isMeta ? 'send-meta-dm' : 'send-whatsapp';
const payload = isMeta
  ? { message_id, platform: selectedContact.platform, recipient_id: selectedContact.phone_number, content, branch_id: selectedBranch }
  : { message_id, phone_number: selectedContact.phone_number, content, branch_id: selectedBranch };
const { error: sendError } = await supabase.functions.invoke(fn, { body: payload });
```

Same status-update + auto-pause-bot logic afterward. The duplicate call at line 591 (in the message-retry path) gets the same routing.

### 3. Same route in `dispatch-communication`

`supabase/functions/dispatch-communication/index.ts` currently has a WhatsApp branch only. Add a parallel **`channel: 'instagram'`** branch that calls the new `send-meta-dm` so any automation that goes through the dispatcher (e.g. handoff replies, future IG triggers) also works. WhatsApp branch untouched. Per-member `do_not_contact` honoring stays unchanged.

### 4. Verification

- Open the IG conversation for `IG · 344744`, type a message, send → check:
  - Network: POST to `send-meta-dm` returns 200.
  - DB: `whatsapp_messages` row goes `pending → sent`.
  - DM lands on the recipient's Instagram (within the 24h reply window — same constraint as Meta's Private Replies).
- Try sending to a brand-new IG sender outside the 24h window → expect a graceful "outside_messaging_window" error surfaced in the toast.
- WhatsApp send still works (regression check on a WA contact).

## Out of scope

- No header/avatar/UI changes (last turn's cleanup stands).
- No backfill changes — Meta backfill skipped 6 test IDs because those IGSIDs are not real users for this token (test IDs from app-review tooling); that's a Meta-side dataset issue, not a code bug.
- Messenger attachments / IG media outbound — text-only in v1; we can add image/document later using the same `/messages` endpoint with `attachment` payload.
