
-- 1. Zoho Books sync log
CREATE TABLE IF NOT EXISTS public.zoho_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('invoice','payment','contact')),
  entity_id uuid NOT NULL,
  zoho_id text,
  zoho_org_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','failed','skipped')),
  error text,
  payload jsonb,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

GRANT SELECT ON public.zoho_sync_log TO authenticated;
GRANT ALL ON public.zoho_sync_log TO service_role;

ALTER TABLE public.zoho_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and admins read zoho sync log"
ON public.zoho_sync_log FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]));

CREATE TRIGGER update_zoho_sync_log_updated_at
BEFORE UPDATE ON public.zoho_sync_log
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_zoho_sync_log_status ON public.zoho_sync_log(entity_type, status);

-- 2. Security fix: branch-scope staff access to onboarding signatures
DROP POLICY IF EXISTS "mos_staff_manage" ON public.member_onboarding_signatures;

CREATE POLICY "mos_staff_write_branch"
ON public.member_onboarding_signatures FOR INSERT TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_onboarding_signatures.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

CREATE POLICY "mos_staff_update_branch"
ON public.member_onboarding_signatures FOR UPDATE TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_onboarding_signatures.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_onboarding_signatures.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

CREATE POLICY "mos_admin_delete"
ON public.member_onboarding_signatures FOR DELETE TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]));
