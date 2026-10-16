DROP POLICY IF EXISTS "signed-in users read locker pricing" ON public.locker_pricing_settings;
CREATE POLICY "branch users read locker pricing" ON public.locker_pricing_settings
FOR SELECT TO authenticated
USING (
  branch_id IN (SELECT ub.branch_id FROM public.user_visible_branches((SELECT auth.uid())) ub)
  OR branch_id IN (SELECT m.branch_id FROM public.members m WHERE m.user_id = (SELECT auth.uid()))
);