# Phone push (Firebase) configured from Settings → Integrations

## Goal
Phone push for the Flutter apps stops depending on the Firebase connector. Firebase is set up and tested from Settings → Integrations, like SMS, WhatsApp and payments.

## Important limit
The connector keeps the Firebase private key hidden, and nobody can read it back out, including the app. So "use the same parameters" can only carry over the public parts (project `incline-b00c5`). An owner has to upload the Firebase service account file once on the new screen. It's the JSON downloaded from Firebase Console → Project settings → Service accounts → Generate new private key. The connector stays as a fallback until that upload is done, then it can be unlinked.

## What the owner will see
A new **Push (Firebase)** tab in Settings → Integrations (owner/admin only):
- Upload the service account file. The project ID and client email fill in automatically, and the private key is never shown again (only "Key saved · uploaded on …").
- An on/off switch for phone push. It starts off and turns on after a successful test.
- A **Test connection** button that does a dry-run send (Firebase validates it, nothing is delivered) and shows OK or the exact Firebase error.
- Live counts: registered phones and browsers, plus pushes sent and failed in the last 24 h.
- Fully keyboard accessible, with labelled fields and status shown in text as well as colour.

## How sending works after the change
```text
notification -> web-push worker -> reads Firebase settings (server only)
   -> signs Google token from service account (cached ~55 min)
   -> FCM v1 send directly
   -> fallback: connector only if no settings saved yet
```
- Stale phone tokens (UNREGISTERED / INVALID_ARGUMENT) are deleted, as they are today. Busy (429) and server (5xx) errors are retried by the existing queue backoff.
- Browser push is unchanged.

## Technical details
- **Storage:** new `push_provider_settings` table (one global row; branch override is possible later). Public fields: project_id, client_email, enabled, updated_by/at. The private key sits in a **service-role-only** column/table with no client policies, the same pattern as the Web Push keys. Writes go only through audited SECURITY DEFINER RPCs `save_fcm_settings` / `set_fcm_enabled`, which need owner/admin (`rpc_guard_applies` + capability check). EXECUTE is granted to authenticated only for these, and every change is written to audit_logs.
- **Validation:** the edge function validates the uploaded JSON with Zod (`type=service_account`, project_id, client_email, PEM private_key) before calling the RPC. The client never writes the key column directly.
- **New edge function `fcm-admin`:** actions `save`, `test` (validate_only send), `status` (counts). JWT verified in code, owner/admin only, CORS, try/catch, version comment, provider errors returned with status and body.
- **`web-push` v2.2.0:** shared `_shared/fcm.ts` does the JWT RS256 signing with WebCrypto, exchanges it at oauth2.googleapis.com/token (scope firebase.messaging), caches the token in memory, and sends to `fcm.googleapis.com/v1/projects/{id}/messages:send`. The connector path is kept only as a fallback.
- **Flag:** `enabled` acts as the kill switch. When it's off, phone pushes stay queued with the reason "phone push disabled". Nothing is dropped.
- **Analytics:** track `push_settings_saved`, `push_test_succeeded`, `push_test_failed` (no key material in properties).
- **Tests:** Deno tests for the service-account validator, JWT claim building (iss/aud/exp) and error classification (stale vs retry).
- **Docs:** update AGENTS.md rule ("phone push credentials live in service-role-only settings, connector is fallback") and the Flutter guides' push section.

## After approval, the owner does
1. Open Settings → Integrations → Push (Firebase).
2. Upload the service account JSON, press Test, then switch it on.
