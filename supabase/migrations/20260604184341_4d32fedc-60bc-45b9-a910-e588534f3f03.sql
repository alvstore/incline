
-- 1. Add external_username column to whatsapp_chat_settings
ALTER TABLE public.whatsapp_chat_settings
  ADD COLUMN IF NOT EXISTS external_username text;

-- 2. Update upsert_meta_contact_profile RPC to accept external_username
CREATE OR REPLACE FUNCTION public.upsert_meta_contact_profile(
  p_branch_id uuid,
  p_phone text,
  p_platform text,
  p_external_id text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_avatar_source text DEFAULT NULL,
  p_avatar_synced_at timestamptz DEFAULT NULL,
  p_avatar_consent_blocked boolean DEFAULT false,
  p_external_username text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.whatsapp_chat_settings (
    branch_id, phone_number, platform, contact_name, contact_avatar_url,
    avatar_source, avatar_synced_at, avatar_consent_blocked, external_username
  )
  VALUES (
    p_branch_id, p_phone, p_platform::text, p_display_name, p_avatar_url,
    p_avatar_source, p_avatar_synced_at, p_avatar_consent_blocked, p_external_username
  )
  ON CONFLICT (branch_id, phone_number) DO UPDATE
  SET contact_name = COALESCE(EXCLUDED.contact_name, whatsapp_chat_settings.contact_name),
      contact_avatar_url = COALESCE(EXCLUDED.contact_avatar_url, whatsapp_chat_settings.contact_avatar_url),
      avatar_source = COALESCE(EXCLUDED.avatar_source, whatsapp_chat_settings.avatar_source),
      avatar_synced_at = COALESCE(EXCLUDED.avatar_synced_at, whatsapp_chat_settings.avatar_synced_at),
      avatar_consent_blocked = EXCLUDED.avatar_consent_blocked OR whatsapp_chat_settings.avatar_consent_blocked,
      external_username = COALESCE(EXCLUDED.external_username, whatsapp_chat_settings.external_username),
      platform = COALESCE(EXCLUDED.platform, whatsapp_chat_settings.platform);

  -- backfill lead full_name from display_name where missing
  IF p_display_name IS NOT NULL THEN
    UPDATE public.leads
    SET full_name = p_display_name
    WHERE phone = p_phone
      AND (full_name IS NULL OR full_name = '' OR full_name ~ '^\+?\d+$');
  END IF;
END;
$$;

-- 3. Inbound message dedupe: content-hash within same minute when mid is null
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS dedupe_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_inbound_dedupe_hash_idx
  ON public.whatsapp_messages (branch_id, phone_number, direction, dedupe_hash)
  WHERE dedupe_hash IS NOT NULL;

-- 4. Backfill lead source from referrer_url (linktree etc) — last 90 days only
UPDATE public.leads
SET source = CASE
  WHEN referrer_url ILIKE '%linktr.ee%' OR referrer_url ILIKE '%linktree%' THEN 'linktree'
  WHEN referrer_url ILIKE '%instagram.com%' OR referrer_url ILIKE '%ig.me%' THEN 'instagram'
  WHEN referrer_url ILIKE '%facebook.com%' OR referrer_url ILIKE '%fb.me%' THEN 'facebook'
  WHEN referrer_url ILIKE '%wa.me%' OR referrer_url ILIKE '%whatsapp.com%' THEN 'whatsapp'
  WHEN referrer_url ILIKE '%youtube.com%' OR referrer_url ILIKE '%youtu.be%' THEN 'youtube'
  WHEN referrer_url ILIKE '%google.%' THEN 'google'
  WHEN referrer_url ILIKE '%t.co%' OR referrer_url ILIKE '%twitter.com%' OR referrer_url ILIKE '%x.com%' THEN 'twitter'
  ELSE source
END
WHERE source = 'website'
  AND referrer_url IS NOT NULL
  AND referrer_url <> ''
  AND created_at > now() - interval '90 days';
