-- 1. contacts: NULL-branch rows only for owner/admin
DROP POLICY IF EXISTS "contacts_select_staff" ON public.contacts;
CREATE POLICY "contacts_select_staff"
ON public.contacts FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IS NOT NULL
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- 2. whatsapp_conversation_state: branch scoping
DROP POLICY IF EXISTS "Staff view conversation state" ON public.whatsapp_conversation_state;
CREATE POLICY "Staff view conversation state"
ON public.whatsapp_conversation_state FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IS NOT NULL
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- 3. profiles: block self-service edits of sensitive/audit fields
CREATE OR REPLACE FUNCTION public.tg_profiles_guard_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- service role / internal jobs and privileged staff may change anything
  IF auth.uid() IS NULL
     OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role]) THEN
    RETURN NEW;
  END IF;

  IF NEW.government_id_verified IS DISTINCT FROM OLD.government_id_verified
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.comm_consent_granted IS DISTINCT FROM OLD.comm_consent_granted
     OR NEW.comm_consent_text IS DISTINCT FROM OLD.comm_consent_text
     OR NEW.comm_consent_at IS DISTINCT FROM OLD.comm_consent_at
     OR NEW.comm_consent_source IS DISTINCT FROM OLD.comm_consent_source
     OR NEW.comm_consent_channels IS DISTINCT FROM OLD.comm_consent_channels THEN
    RAISE EXCEPTION 'FORBIDDEN_FIELD_UPDATE: verification and consent fields can only be changed by staff'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard_sensitive_fields ON public.profiles;
CREATE TRIGGER trg_profiles_guard_sensitive_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_guard_sensitive_fields();