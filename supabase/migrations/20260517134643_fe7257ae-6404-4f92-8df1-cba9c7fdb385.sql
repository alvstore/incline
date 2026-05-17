ALTER TABLE public.whatsapp_chat_settings
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_avatar_url text;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE OR REPLACE FUNCTION public.upsert_meta_contact_profile(
  p_branch_id uuid,
  p_phone text,
  p_platform text,
  p_external_id text,
  p_display_name text,
  p_avatar_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_branch_id IS NULL OR p_phone IS NULL THEN
    RETURN;
  END IF;

  -- Upsert into whatsapp_chat_settings (keep existing name/avatar when new is null)
  INSERT INTO public.whatsapp_chat_settings (
    branch_id, phone_number, platform, contact_name, contact_avatar_url
  )
  VALUES (
    p_branch_id,
    p_phone,
    COALESCE(p_platform, 'whatsapp')::messaging_platform,
    p_display_name,
    p_avatar_url
  )
  ON CONFLICT (branch_id, phone_number) DO UPDATE
  SET contact_name = COALESCE(public.whatsapp_chat_settings.contact_name, EXCLUDED.contact_name),
      contact_avatar_url = COALESCE(EXCLUDED.contact_avatar_url, public.whatsapp_chat_settings.contact_avatar_url),
      updated_at = now();

  -- Backfill lead name/avatar (never overwrite human-edited name)
  UPDATE public.leads
  SET full_name = CASE
        WHEN full_name IS NULL OR full_name = '' OR full_name = phone THEN COALESCE(p_display_name, full_name)
        ELSE full_name
      END,
      avatar_url = COALESCE(p_avatar_url, avatar_url),
      updated_at = now()
  WHERE branch_id = p_branch_id
    AND phone = p_phone;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_meta_contact_profile(uuid, text, text, text, text, text) TO authenticated, service_role;