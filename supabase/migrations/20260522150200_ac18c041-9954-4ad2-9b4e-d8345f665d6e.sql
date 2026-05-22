ALTER TABLE public.whatsapp_chat_settings
  ADD COLUMN IF NOT EXISTS avatar_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS avatar_source text,
  ADD COLUMN IF NOT EXISTS avatar_consent_blocked boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_chat_settings_avatar_source_chk') THEN
    ALTER TABLE public.whatsapp_chat_settings
      ADD CONSTRAINT whatsapp_chat_settings_avatar_source_chk
      CHECK (avatar_source IS NULL OR avatar_source IN ('storage','meta_cdn','default'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wcs_avatar_consent_blocked
  ON public.whatsapp_chat_settings (platform, phone_number)
  WHERE avatar_consent_blocked = true;

DROP FUNCTION IF EXISTS public.upsert_meta_contact_profile(uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.upsert_meta_contact_profile(
  p_branch_id uuid,
  p_phone text,
  p_platform text,
  p_external_id text,
  p_display_name text,
  p_avatar_url text,
  p_avatar_source text DEFAULT NULL,
  p_avatar_synced_at timestamptz DEFAULT NULL,
  p_avatar_consent_blocked boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.whatsapp_chat_settings AS s (
    branch_id, phone_number, platform, contact_name, contact_avatar_url,
    avatar_source, avatar_synced_at, avatar_consent_blocked
  ) VALUES (
    p_branch_id, p_phone, p_platform::messaging_platform, p_display_name, p_avatar_url,
    p_avatar_source, p_avatar_synced_at, COALESCE(p_avatar_consent_blocked, false)
  )
  ON CONFLICT (branch_id, phone_number) DO UPDATE SET
    contact_name = COALESCE(EXCLUDED.contact_name, s.contact_name),
    contact_avatar_url = COALESCE(EXCLUDED.contact_avatar_url, s.contact_avatar_url),
    avatar_source = COALESCE(EXCLUDED.avatar_source, s.avatar_source),
    avatar_synced_at = COALESCE(EXCLUDED.avatar_synced_at, s.avatar_synced_at),
    avatar_consent_blocked = COALESCE(p_avatar_consent_blocked, s.avatar_consent_blocked),
    platform = COALESCE(EXCLUDED.platform, s.platform);

  IF p_display_name IS NOT NULL OR p_avatar_url IS NOT NULL THEN
    UPDATE public.leads l
    SET
      full_name = COALESCE(NULLIF(l.full_name, ''), p_display_name),
      avatar_url = COALESCE(NULLIF(l.avatar_url, ''), p_avatar_url)
    WHERE l.phone = p_phone
      AND (p_branch_id IS NULL OR l.branch_id = p_branch_id);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_meta_contact_profile(
  uuid, text, text, text, text, text, text, timestamptz, boolean
) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='avatars_meta_public_read'
  ) THEN
    CREATE POLICY "avatars_meta_public_read"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'avatars' AND name LIKE 'meta/%');
  END IF;
END $$;