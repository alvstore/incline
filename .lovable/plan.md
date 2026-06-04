# Audit findings + fix plan

## 1. Lead source always shows "Website"

**Root cause**
- `src/pages/EmbedLeadForm.tsx` line 38 hard-codes `source: 'website'` regardless of how the visitor arrived.
- `supabase/functions/capture-lead/index.ts` line 75 falls back to `'website'` and does NOT inspect the referrer/landing-page it already receives (lines 81-82).
- Linktree, Instagram, FB Ads, WhatsApp click-to-chat, QR codes, and embed widgets therefore all collapse to `website`.

**Fix**
1. In `EmbedLeadForm.tsx`, derive `source` from a precedence chain:
   `?utm_source=` → referrer host map → fallback `'website'`.
   Referrer host map: `linktr.ee→linktree`, `instagram.com|ig.me→instagram`, `facebook.com|fb.me→facebook`, `wa.me|whatsapp.com→whatsapp`, `google.*→google`, `youtube.*→youtube`, `t.co|twitter.com|x.com→twitter`.
2. Send `landing_page = window.location.href` and `referrer_url = document.referrer` (currently missing — that's why backend gets empty strings).
3. In `capture-lead/index.ts`, when caller did not supply an explicit `source`, run the same referrer-host map server-side as a safety net before falling back to `website`.
4. Add a small `src/lib/leads/sourceFromReferrer.ts` shared by the embed form and `AddLeadDrawer` (so staff-typed walk-ins can auto-suggest source from a pasted link).
5. Backfill SQL (one-shot migration): re-classify existing `leads` rows where `source='website'` AND `referrer_url ILIKE '%linktr.ee%'` (etc.) using the same map. Cap to last 90 days.

## 2. Instagram chat shows raw IGSID `+17085697668...`

**Root cause**
- `meta-webhook/index.ts` `resolveInstagramSenderProfile` (line 764) calls Graph `/{igsid}?fields=name,username,profile_pic_url`. When the integration uses **Instagram Login** without `instagram_business_basic` consent, Meta returns the `consent_blocked` error and we cache `name=null` for 24h.
- Webhook fallback never tries the cheaper, consent-free **`/me/conversations?user_id={igsid}&fields=participants`** lookup, which usually returns username for users who DM'd us.
- UI (`whatsapp_chat_settings.contact_name` is null) → component renders `phone_number` (the IGSID).

**Fix**
1. Add a second resolution step in `resolveInstagramSenderProfile`: if primary `/igsid` returns empty/consent-blocked, query `/me/conversations?user_id={igsid}&fields=participants{username,name,profile_pic}` and extract the non-business participant. Cache result the same way.
2. Persist `ig_username` separately on `whatsapp_chat_settings` (new column `external_username text`) so the chat list can show `@username` even when display name is blocked. Migration adds the column + updates `upsert_meta_contact_profile` RPC signature.
3. Chat list / header components (`ChatList`, `ChatHeader`) — fall back to display order: `contact_name` → `@external_username` → `Instagram User · …4567` (last 4 of IGSID) instead of the full numeric ID.
4. Add a one-shot "Re-resolve IG profiles" admin action in `meta-admin` (already exported `resolveInstagramSenderProfile`) that loops over the last 60 days of `whatsapp_chat_settings` rows with platform=instagram and missing name.

## 3. Duplicate AI replies on Instagram

**Root cause**
- Meta delivers some Instagram Login DMs on BOTH `entry.messaging[]` AND `entry.changes[].value` (`field=messages`). The inbound message dedupe in `ingestMessagingEvent` only works when `message.mid` is present — IG Login `messages` change events often omit `mid`.
- Two inserts → two `triggerAiReply` calls → two outbound copies (visible in screenshot: every bot reply appears twice).
- Meta also retries webhooks on 5xx, and our function returns 200 only after AI runs (long path), so duplicates are likely from genuine retries too.

**Fix**
1. **Synchronous dedupe at insert**: change `ingestMessagingEvent` to do an early `upsert` on `whatsapp_messages` keyed by a deterministic hash `(branch_id, phone_number, direction, content_hash, ts_minute)` when `mid` is missing, returning early on conflict. Add partial unique index on that hash.
2. **AI-trigger guard**: before `triggerAiReply`, take a Postgres advisory lock `pg_try_advisory_xact_lock(hashtextextended(branch_id||sender_id||content, 0))` inside a short RPC; skip if not acquired. Also check no outbound message exists for same conversation in the last 30s.
3. **Return 200 earlier**: respond to Meta immediately after the message insert; move AI reply onto `EdgeRuntime.waitUntil(...)` so retries on slow responses stop firing.
4. The double "Welcome to Incline" + double "What's your name?" on the +15168… chat is the same bug — fix here covers it.

## 4. Telinfy / GreenAds RCS — go live

**Steps**
1. `secrets--add_secret` for `TELINFY_API_KEY`, `TELINFY_SENDER_ID`, `TELINFY_BASE_URL` (user enters in secure form).
2. Implement real `POST {base_url}/rcs/send/text` (+ `/rcs/send/card` when `payload.kind='card'`) in `supabase/functions/send-rcs/index.ts` v0.2.0 — Bearer auth, JSON body `{ sender, to, message, dlt_template_id }`, map response to dispatcher contract (`status: sent|failed`, `provider_message_id`).
3. Wire into `dispatch-communication` channel router (already accepts `rcs`).
4. New edge fn `rcs-webhook/index.ts` for DLR callbacks → updates `communication_logs.delivery_status` by `provider_message_id`. Public URL noted for user to paste into Telinfy dashboard.
5. Settings → Integrations: add an "RCS (Telinfy)" card (provider already in `providerSchemas.ts`) showing sender ID + DLR webhook URL + a "Send test" button.

## Files touched (build phase)

**New**
- `src/lib/leads/sourceFromReferrer.ts`
- `supabase/functions/rcs-webhook/index.ts`
- 2 SQL migrations (column + index + backfill + RPC signature update)

**Edited**
- `src/pages/EmbedLeadForm.tsx`, `src/components/leads/AddLeadDrawer.tsx`
- `supabase/functions/capture-lead/index.ts`, `webhook-lead-capture/index.ts`
- `supabase/functions/meta-webhook/index.ts` (3 fixes: profile resolver, dedupe, waitUntil)
- `supabase/functions/send-rcs/index.ts` → v0.2.0
- `supabase/functions/meta-admin/index.ts` (backfill action)
- WhatsApp chat list + header components (display fallback)
- `src/integrations/supabase/types.ts` (regen after migration)

## Out of scope
- Migrating consent-blocked IG users to a different OAuth scope (requires re-auth UX, separate epic).
- RCS template management UI (lands once Telinfy returns the first DLR).
