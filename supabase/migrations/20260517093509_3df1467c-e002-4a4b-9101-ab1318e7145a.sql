
-- Do-Not-Contact engine — add opt-out flags across the three contact tables
ALTER TABLE public.whatsapp_chat_settings
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text,
  ADD COLUMN IF NOT EXISTS do_not_contact_until timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_by text;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text,
  ADD COLUMN IF NOT EXISTS do_not_contact_until timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_by text;

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason text,
  ADD COLUMN IF NOT EXISTS do_not_contact_until timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS do_not_contact_set_by text;

CREATE INDEX IF NOT EXISTS idx_chat_settings_dnc
  ON public.whatsapp_chat_settings (branch_id) WHERE do_not_contact = true;
CREATE INDEX IF NOT EXISTS idx_leads_dnc
  ON public.leads (branch_id) WHERE do_not_contact = true;
CREATE INDEX IF NOT EXISTS idx_members_dnc
  ON public.members (branch_id) WHERE do_not_contact = true;

-- Helper RPC: stamp the flag across all contact records matching a phone (+ optional branch).
-- Used by inbound opt-out detector AND by the WhatsApp AI agent tool.
CREATE OR REPLACE FUNCTION public.mark_do_not_contact(
  p_phone text,
  p_branch_id uuid,
  p_reason text DEFAULT 'lead_request',
  p_until timestamptz DEFAULT NULL,
  p_source text DEFAULT 'auto'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_chats int := 0;
  v_leads int := 0;
  v_members int := 0;
BEGIN
  IF v_digits = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone_required');
  END IF;

  -- whatsapp_chat_settings (phone may be stored with or without +)
  UPDATE public.whatsapp_chat_settings
     SET do_not_contact = true,
         do_not_contact_reason = p_reason,
         do_not_contact_until  = p_until,
         do_not_contact_set_at = now(),
         do_not_contact_set_by = p_source,
         updated_at = now()
   WHERE regexp_replace(phone_number, '\D', '', 'g') = v_digits
     AND (p_branch_id IS NULL OR branch_id = p_branch_id);
  GET DIAGNOSTICS v_chats = ROW_COUNT;

  UPDATE public.leads
     SET do_not_contact = true,
         do_not_contact_reason = p_reason,
         do_not_contact_until  = p_until,
         do_not_contact_set_at = now(),
         do_not_contact_set_by = p_source,
         updated_at = now()
   WHERE regexp_replace(phone, '\D', '', 'g') = v_digits
     AND (p_branch_id IS NULL OR branch_id = p_branch_id);
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  UPDATE public.members
     SET do_not_contact = true,
         do_not_contact_reason = p_reason,
         do_not_contact_until  = p_until,
         do_not_contact_set_at = now(),
         do_not_contact_set_by = p_source,
         updated_at = now()
   WHERE regexp_replace(coalesce(phone_number,''), '\D', '', 'g') = v_digits
     AND (p_branch_id IS NULL OR branch_id = p_branch_id);
  GET DIAGNOSTICS v_members = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'chats_updated', v_chats,
    'leads_updated', v_leads,
    'members_updated', v_members
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_do_not_contact(text, uuid, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_do_not_contact(text, uuid, text, timestamptz, text)
  TO authenticated, service_role;

-- Helper RPC: clear the flag (staff override).
CREATE OR REPLACE FUNCTION public.clear_do_not_contact(
  p_phone text,
  p_branch_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
BEGIN
  UPDATE public.whatsapp_chat_settings
     SET do_not_contact = false, do_not_contact_until = NULL,
         do_not_contact_reason = NULL, do_not_contact_set_at = NULL,
         do_not_contact_set_by = NULL, updated_at = now()
   WHERE regexp_replace(phone_number, '\D', '', 'g') = v_digits
     AND (p_branch_id IS NULL OR branch_id = p_branch_id);
  UPDATE public.leads
     SET do_not_contact = false, do_not_contact_until = NULL,
         do_not_contact_reason = NULL, do_not_contact_set_at = NULL,
         do_not_contact_set_by = NULL, updated_at = now()
   WHERE regexp_replace(phone, '\D', '', 'g') = v_digits
     AND (p_branch_id IS NULL OR branch_id = p_branch_id);
  UPDATE public.members
     SET do_not_contact = false, do_not_contact_until = NULL,
         do_not_contact_reason = NULL, do_not_contact_set_at = NULL,
         do_not_contact_set_by = NULL, updated_at = now()
   WHERE regexp_replace(coalesce(phone_number,''), '\D', '', 'g') = v_digits
     AND (p_branch_id IS NULL OR branch_id = p_branch_id);
  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.clear_do_not_contact(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_do_not_contact(text, uuid)
  TO authenticated, service_role;
