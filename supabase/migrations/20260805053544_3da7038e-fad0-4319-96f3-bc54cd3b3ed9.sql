DROP POLICY IF EXISTS "View active plans" ON public.membership_plans;

CREATE POLICY "Public sees visible active plans"
ON public.membership_plans
FOR SELECT
TO anon
USING (is_active = true AND is_visible_to_members = true);

CREATE POLICY "Members see active plans"
ON public.membership_plans
FOR SELECT
TO authenticated
USING (
  (is_active = true AND is_visible_to_members = true)
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role])
);