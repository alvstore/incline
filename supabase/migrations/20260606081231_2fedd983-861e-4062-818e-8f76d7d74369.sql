-- 1) branches: replace blanket-true read with a role-gated read.
DROP POLICY IF EXISTS "View branches" ON public.branches;
CREATE POLICY "Staff view branches"
  ON public.branches
  FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(
      auth.uid(),
      ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role, 'trainer'::app_role]
    )
  );

-- 2) invoices: add role check to the branch-scoped read policy.
DROP POLICY IF EXISTS "Staff view branch invoices" ON public.invoices;
CREATE POLICY "Staff view branch invoices"
  ON public.invoices
  FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(
      auth.uid(),
      ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role]
    )
    AND (
      (branch_id = public.get_user_branch(auth.uid()))
      OR public.manages_branch(auth.uid(), branch_id)
    )
  );

-- 3) member_attendance: add role check to ALL policy so members cannot read
-- attendance records for other members at the same branch.
DROP POLICY IF EXISTS "Staff manage attendance" ON public.member_attendance;
CREATE POLICY "Staff manage attendance"
  ON public.member_attendance
  FOR ALL
  TO authenticated
  USING (
    public.has_any_role(
      auth.uid(),
      ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role]
    )
    AND (
      (branch_id = public.get_user_branch(auth.uid()))
      OR public.manages_branch(auth.uid(), branch_id)
    )
  )
  WITH CHECK (
    public.has_any_role(
      auth.uid(),
      ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role]
    )
    AND (
      (branch_id = public.get_user_branch(auth.uid()))
      OR public.manages_branch(auth.uid(), branch_id)
    )
  );