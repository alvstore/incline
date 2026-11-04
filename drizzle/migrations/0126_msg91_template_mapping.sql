ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS msg91_template_id text,
  ADD COLUMN IF NOT EXISTS msg91_version_id text,
  ADD COLUMN IF NOT EXISTS msg91_sync_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN IF NOT EXISTS msg91_sync_error text,
  ADD COLUMN IF NOT EXISTS msg91_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS msg91_synced_content_hash text;

ALTER TABLE public.templates
  ADD CONSTRAINT templates_msg91_sync_status_check
  CHECK (msg91_sync_status IN ('not_synced','synced','failed','needs_resync'));

COMMENT ON COLUMN public.templates.msg91_template_id IS 'MSG91 SMS template (Flow) ID. Never a DLT ID; DLT stays in dlt_template_id.';
COMMENT ON COLUMN public.templates.msg91_sync_status IS 'MSG91 registration state only — not DLT/operator approval.';

-- MSG91 mapping is written only by backend functions (service role). Any
-- client edit to body/header/DLT ID of a synced template marks it for resync.
CREATE OR REPLACE FUNCTION public.tg_templates_msg91_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.msg91_template_id := NULL;
      NEW.msg91_version_id := NULL;
      NEW.msg91_sync_status := 'not_synced';
      NEW.msg91_sync_error := NULL;
      NEW.msg91_synced_at := NULL;
      NEW.msg91_synced_content_hash := NULL;
      RETURN NEW;
    END IF;
    NEW.msg91_template_id := OLD.msg91_template_id;
    NEW.msg91_version_id := OLD.msg91_version_id;
    NEW.msg91_sync_status := OLD.msg91_sync_status;
    NEW.msg91_sync_error := OLD.msg91_sync_error;
    NEW.msg91_synced_at := OLD.msg91_synced_at;
    NEW.msg91_synced_content_hash := OLD.msg91_synced_content_hash;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.msg91_template_id IS NOT NULL
     AND NEW.msg91_sync_status = 'synced'
     AND (NEW.content IS DISTINCT FROM OLD.content
          OR NEW.dlt_header IS DISTINCT FROM OLD.dlt_header
          OR NEW.dlt_template_id IS DISTINCT FROM OLD.dlt_template_id
          OR NEW.variables IS DISTINCT FROM OLD.variables)
     AND NEW.msg91_synced_content_hash IS NOT DISTINCT FROM OLD.msg91_synced_content_hash THEN
    NEW.msg91_sync_status := 'needs_resync';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_templates_msg91_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS templates_msg91_guard ON public.templates;
CREATE TRIGGER templates_msg91_guard
  BEFORE INSERT OR UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_templates_msg91_guard();