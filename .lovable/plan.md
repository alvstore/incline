## Audit — chat profile pictures & names

### Findings

**1. Instagram contacts show no username and no avatar — root cause confirmed**

DB inspection of `integration_settings` for the active IG row:
- `provider='instagram_meta'`, `integration_type='instagram'`, `is_active=true`
- `config.page_id=934192826441479`, `config.instagram_account_id=17841478914282824`
- `credentials.access_token` ✅ present (User token, `EAA…`)
- `credentials.page_access_token` ❌ **missing**
- `credentials.app_secret` ✅ present

`resolveInstagramSenderProfile()` in `supabase/functions/meta-webhook/index.ts:709` calls:
```
GET graph.facebook.com/v25.0/{IGSID}?fields=name,username,profile_pic_url&access_token=<token>
```
with whatever `credentials.access_token || credentials.page_access_token` is set. For the IG-via-FB-Page flow used here, Meta requires a **Page Access Token** (not a User token) for this lookup. With the current User token Meta returns either a permissions error or an empty body — and the code treats `resp.ok=true` with empty fields as success, so a `null` name/avatar is silently cached and written.

Database confirms: all `whatsapp_chat_settings` rows where `platform='instagram'` have `contact_name=NULL`, `contact_avatar_url=NULL`. The UI's `displayLabel()` then falls back to the raw IGSID number ("1323869973018720"), which matches what the screenshot shows (the IG chats only display gradient initials and have no displayed username).

**2. WhatsApp contact has name but no profile picture — Meta API limitation, not a bug**

The WhatsApp Cloud API does not expose contact profile photos under any endpoint. Only `contacts[0].profile.name` is delivered in inbound payloads, which the webhook already persists (and the screenshot shows "Rajat Lekhari" correctly). The codebase and project memory already document this constraint. Avatar can only come from a matched internal record (member/lead with `avatar_url`). Today, `resolveIdentity()` does not return `avatar_url`, so the chat list cannot fall back to a member/lead avatar even when one exists.

---

### Fix plan

**A. Instagram — get name + avatar to populate**

1. `meta-webhook/index.ts` › `resolveInstagramSenderProfile()`:
   - Prefer `credentials.page_access_token` for IG-via-Page (when `config.page_id` is set), fall back to `access_token`.
   - Treat an "ok" response with no `id`/`name`/`username` as a failure; log the upstream error message and HTTP status so we have something actionable in edge logs.
   - On every successful resolve, write the result to `whatsapp_chat_settings` via the existing `upsert_meta_contact_profile` RPC (already done).

2. `meta-oauth-callback/index.ts`:
   - After exchanging the user/long-lived token, call `GET /me/accounts?access_token=<USER_TOKEN>` once, find the entry matching the configured `page_id`, and persist `access_token` from that entry as `credentials.page_access_token` on the row. This is the missing piece that makes step 1 work in production.
   - Backwards-compat: existing rows without `page_access_token` keep working via the `access_token` fallback.

3. New helper edge function (or extend `meta-admin`) — `action: "backfill_ig_profiles"`:
   - Scans `whatsapp_chat_settings` where `platform IN ('instagram','messenger')` AND `contact_name IS NULL`.
   - For each, call `resolveInstagramSenderProfile()` and upsert via `upsert_meta_contact_profile`.
   - Owner/admin only, run-on-demand from a button in `IntegrationSettings.tsx` (Meta section).

4. `WhatsAppChat.tsx` › `displayLabel()`:
   - When `contact_name` is null AND `platform='instagram'`, show `IG · <last 6 of id>` instead of the raw 16-digit IGSID so it reads better while backfill runs.

**B. WhatsApp — avatar via matched member/lead**

1. `src/lib/contacts/resolveIdentity.ts`:
   - Add `avatar_url?: string | null` to `ResolvedIdentity`.
   - Select `avatar_url` from `profiles` (members path) and `leads` (lead path); contact book stays as-is unless we add that column too.

2. `src/pages/WhatsAppChat.tsx` enrichment (line ~369):
   - Avatar priority becomes: `c.contact_avatar_url` → `s?.contact_avatar_url` → `ident?.avatar_url` → null.
   - No schema change needed.

3. `AvatarFallback` (line ~921) keeps the gradient initials when nothing resolves. Add a `title="WhatsApp does not share profile photos — showing initials"` on WA fallback for clarity.

**C. Optional — UX badge**

Add a small "Profile not shared" hint chip next to the WA avatar when no identity match exists, so staff know it's expected behaviour and not a broken integration.

### Files touched

- `supabase/functions/meta-webhook/index.ts` — improve profile resolver + logging.
- `supabase/functions/meta-oauth-callback/index.ts` — persist `page_access_token` at OAuth time.
- `supabase/functions/meta-admin/index.ts` — add `action: "backfill_ig_profiles"`.
- `src/lib/contacts/resolveIdentity.ts` — return `avatar_url`.
- `src/pages/WhatsAppChat.tsx` — use `ident.avatar_url`; improve IG fallback label.
- `src/components/settings/IntegrationSettings.tsx` — "Backfill IG profiles" button in Meta card.

### Validation

- Re-OAuth IG once → DB row gets `page_access_token`.
- Send a fresh IG DM → `whatsapp_chat_settings.contact_name` + `contact_avatar_url` populate.
- Run backfill → existing IG conversations show username + avatar.
- A WA contact whose phone matches an existing member with `avatar_url` → chat list shows that avatar.
- A WA contact with no internal record → still shows gradient initials with hint tooltip (unchanged behaviour, expected).

### Out of scope

- WhatsApp profile pictures from any third-party enricher (e.g., Truecaller). Meta does not expose them and we shouldn't scrape.
- Bulk IG profile refresh on a cron — backfill is on-demand only to avoid burning Graph rate limits.

Approve to implement?