DROP POLICY IF EXISTS "Staff can view org settings" ON public.organization_settings;
DROP POLICY IF EXISTS "Admin can manage org settings" ON public.organization_settings;

CREATE POLICY "Owners and admins manage all org settings"
ON public.organization_settings
FOR ALL
TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers manage their branch org settings"
ON public.organization_settings
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['manager'::app_role])
  AND branch_id IS NOT NULL
  AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['manager'::app_role])
  AND branch_id IS NOT NULL
  AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
);

CREATE POLICY "Staff view their branch org settings"
ON public.organization_settings
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['staff'::app_role])
  AND branch_id IS NOT NULL
  AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
);