## Goal
Persist Meta (Instagram + Messenger) profile pictures into Supabase Storage so they never expire, and stop hammering Meta when consent is missing. WhatsApp avatars stay out of scope (Cloud API does not expose them).

## Current state
- `meta-webhook` and `meta-admin` call `GET /{IGSID}?fields=name,username,profile_pic_url` and write the raw Meta CDN URL into `whatsapp_chat_settings.contact_avatar_url` via `upsert_meta_contact_profile`. That URL expires in days → broken avatars in CRM.
- No consent-error branch — comment-only IGSIDs keep getting re-fetched on every inbound message and silently fail.
- A public `avatars` bucket already exists in Storage. To avoid mixing with member/staff avatars, all Meta-sourced files will live under a dedicated subfolder.

## Plan

### 1. Storage layout (subfolder, not new bucket)
- Reuse the existing public `avatars` bucket.
- New path convention: `avatars/meta/{platform}/{scoped_id}.jpg`
  - `platform` = `instagram` | `messenger`
  - One file per contact, `upsert: true` so re-syncs reuse the same public URL.
- Migration adds a Storage RLS policy: anyone can SELECT objects in `avatars` where `name LIKE 'meta/%'`; writes restricted to service role (used by edge functions only).

### 2. Schema additions on `whatsapp_chat_settings`
- `avatar_synced_at timestamptz` — last successful Storage upload.
- `avatar_source text check (... in ('storage','meta_cdn','default'))` — provenance.
- `avatar_consent_blocked boolean default false` — true when Meta returns "User consent is required" (error code 10 / OAuthException subcode 2018338).
- Partial index `(platform, contact_jid) where avatar_consent_blocked = true` for bulk retry sweeps later.

### 3. RPC update
Extend `upsert_meta_contact_profile` with three optional args: `p_avatar_source`, `p_avatar_synced_at`, `p_avatar_consent_blocked`, written atomically alongside name/avatar.

### 4. Shared helper `supabase/functions/_shared/metaAvatar.ts` (new)
Exports `persistMetaAvatar({ scopedId, platform, cdnUrl, serviceClient })`:
1. `fetch(cdnUrl)` with 5s timeout, follow redirects, body capped at 2MB.
2. Validate `Content-Type` starts with `image/`; otherwise abort.
3. `storage.from('avatars').upload('meta/{platform}/{scopedId}.jpg', bytes, { upsert: true, contentType, cacheControl: '86400' })`.
4. Return `{ publicUrl, source: 'storage', syncedAt }`. On any failure return `{ publicUrl: cdnUrl, source: 'meta_cdn' }` (degrade, never break the webhook).

### 5. `meta-webhook/index.ts`
At the IG profile resolution block (around lines 730–800):
- After `fetchIgProfile` returns `profile_pic_url`, call `persistMetaAvatar(...)` and use its `publicUrl` when calling `upsert_meta_contact_profile`, also passing the new provenance fields.
- Add error classification around the Graph call:
  - Meta error code `10` OR message includes `"User consent is required"` → call `upsert_meta_contact_profile` with `p_avatar_consent_blocked=true`, write name if returned, do NOT retry on subsequent messages.
  - Other transient errors → existing retry-next-message behavior preserved.
- Skip Storage upload entirely when consent is blocked.

### 6. `meta-admin/index.ts`
- The existing manual IG profile refresh (`/{IGSID}` lookup) routes through the same `persistMetaAvatar` helper so admin "Refresh profile" upgrades a `meta_cdn` row to `storage`.
- New action `refresh_all_ig_avatars`:
  - Selects up to 200 rows from `whatsapp_chat_settings` where `platform='instagram'` AND `avatar_consent_blocked=false` AND (`avatar_source IS NULL` OR `avatar_source='meta_cdn'` OR `avatar_synced_at < now() - interval '20 days'`).
  - Re-resolves + persists each. Returns `{ scanned, upgraded, failed, consent_blocked }`.
  - Wired to a new "Refresh all IG avatars" button in the Meta admin panel (small, owner-only).

### 7. Frontend (minimal)
- No change to `WhatsAppChat.tsx` happy path — it already renders `contact_avatar_url`.
- For consent-blocked rows the column stays NULL → existing platform-icon fallback already shown.
- Optional small badge "consent blocked" in the contact detail drawer so staff understand why no photo is present.

### 8. Out of scope
- WhatsApp avatars (impossible via Cloud API).
- Backfill cron — only manual admin bulk action ships now; can be promoted to a 5-min `automation-brain-tick` rule later if desired.
- New buckets — explicitly reusing `avatars` with a `meta/` subfolder per the user's preference.

## Technical notes
- `instagram_manage_messages` + `pages_read_engagement` are already approved on the connected app; no scope change required for DM-initiated lookups.
- Bucket is public → `getPublicUrl('meta/instagram/{IGSID}.jpg')` returns a stable URL with zero signing overhead.
- Cache-busting after re-sync: append `?v={avatar_synced_at_unix}` on the frontend `<img src>` so browsers refresh when the underlying file changes.
- Meta CDN images are typically <100KB; the 2MB cap is a safety net.

## Files touched
- `supabase/migrations/<ts>_meta_avatar_persistence.sql` — new columns + storage policy + RPC update.
- `supabase/functions/_shared/metaAvatar.ts` — new helper.
- `supabase/functions/meta-webhook/index.ts` — use helper + consent branch.
- `supabase/functions/meta-admin/index.ts` — use helper in single refresh + new bulk action.
- (Optional) `src/components/settings/MetaAdminPanel.tsx` (or equivalent) — "Refresh all IG avatars" button.
- Memory: extend `mem://integrations/omnichannel-meta-messaging` with the Storage persistence + consent-blocked rule.