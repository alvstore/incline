## Problem

The PDF link `https://theincline.in/1958853694810503` 404s ("Lost in space") because **only the Meta media ID is being stored**, not a real URL.

In `whatsapp-webhook/index.ts`:
```ts
function extractMediaUrl(message: any): string | null {
  return message?.image?.id ?? message?.video?.id ?? message?.document?.id ?? null;
}
```
This returns the raw Meta media ID (e.g. `1958853694810503`). The chat UI then renders `<a href="1958853694810503">`, which the browser resolves against the current origin → `theincline.in/1958853694810503` → 404.

Meta does NOT give a permanent URL. For inbound media you must:
1. `GET https://graph.facebook.com/v21.0/{media-id}` with the WA access token → returns a short-lived signed `url`.
2. `GET` that URL with the bearer token → returns the binary.
3. Upload the binary into our own storage and persist that URL.

## Plan

### 1. Storage bucket
Create a private bucket `whatsapp-media` (migration) with RLS allowing staff/admin reads. We'll serve via short-lived signed URLs.

### 2. New helper `downloadInboundMedia(mediaId, integration)` in `whatsapp-webhook/index.ts`
- Fetch media metadata from Graph API using the integration's access token.
- Download the binary with the bearer token.
- Detect `mime_type` and `filename` from the message payload (`document.filename`, `document.mime_type`, `image.mime_type`).
- Upload to `whatsapp-media/{yyyy}/{mm}/{wa_message_id}-{safeFilename}`.
- Return `{ storage_path, mime_type, filename, size }`.

### 3. Wire it in
Replace the current single `media_url` extraction with an async resolver. When the inbound message has `image|video|document|audio|sticker`:
- Call `downloadInboundMedia`.
- Store `storage_path` (not signed URL — those expire) in `media_url`, and `mime_type`/`filename` in a small `media_meta` jsonb (add column).
- Keep the original Meta media ID in `media_meta.meta_id` for debugging.

If download fails (token rotated, file expired >5 days), log via `log_error_event` and store `media_meta.error` so UI can show "attachment unavailable".

### 4. Frontend changes (`src/pages/WhatsAppChat.tsx`)
- When `media_url` looks like a storage path (no `http`), call `supabase.storage.from('whatsapp-media').createSignedUrl(path, 300)` lazily on render (cached per message id with TanStack Query).
- For documents, show filename from `media_meta.filename` instead of guessing from URL.
- Add a small "Download" button next to PDFs/docs.
- Fallback UI: greyed "Attachment unavailable — Meta media link expired" when `media_meta.error` is set.

### 5. Backfill existing broken attachments
One-shot edge function `backfill-whatsapp-media` (admin-only) that:
- Selects last 30 days of `messages` where `media_url` matches `^\d+$` (raw Meta IDs).
- Tries to download each via the same helper.
- Updates rows with new storage path, or marks `media_meta.error='expired'` for messages older than 5 days (Meta media TTL).
Run it once after deploy via `supabase--curl_edge_functions`.

### 6. Outbound docs (sanity check)
Outbound documents already use `mediaUrl` from our own upload flow (line 557-570 of WhatsAppChat) — those are real URLs, no change needed.

## Files

- `supabase/migrations/<new>.sql` — bucket + `messages.media_meta jsonb` column + RLS
- `supabase/functions/whatsapp-webhook/index.ts` — `downloadInboundMedia` + call site
- `supabase/functions/backfill-whatsapp-media/index.ts` — new
- `src/pages/WhatsAppChat.tsx` — signed-URL resolver, doc preview tile, error state
- `src/integrations/supabase/types.ts` — auto-regenerated

## Verification
- Send a fresh PDF from your phone to the WA business number → message arrives → attachment tile shows filename, click opens PDF.
- Click on the existing Ajayjat PDF after backfill → either opens or shows clear "expired" message (since Meta only retains media 5 days).
