
-- member_comps: branch-scope non-owner/admin staff and managers
DROP POLICY IF EXISTS "Staff can manage comps" ON public.member_comps;

CREATE POLICY "Owners and admins manage all comps"
  ON public.member_comps
  FOR ALL
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers and staff manage comps in visible branches"
  ON public.member_comps
  FOR ALL
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_comps.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_comps.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  );

-- member_pt_packages: branch-scope everyone except owner/admin
DROP POLICY IF EXISTS "member_pt_select_own" ON public.member_pt_packages;
DROP POLICY IF EXISTS "staff_write_member_pt" ON public.member_pt_packages;

CREATE POLICY "member_pt_select_own_or_branch"
  ON public.member_pt_packages
  FOR SELECT
  TO authenticated
  USING (
    member_id = get_member_id(auth.uid())
    OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (
      has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
      AND EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = member_pt_packages.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
    )
  );

CREATE POLICY "owners_admins_write_member_pt"
  ON public.member_pt_packages
  FOR ALL
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "staff_write_member_pt_branch_scoped"
  ON public.member_pt_packages
  FOR ALL
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_pt_packages.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_pt_packages.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  );
