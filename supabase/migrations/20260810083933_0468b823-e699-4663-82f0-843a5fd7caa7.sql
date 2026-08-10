DROP POLICY IF EXISTS "Manager manage own branch staff" ON public.staff_branches;

CREATE POLICY "Manager manage own branch staff"
ON public.staff_branches
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager'::public.app_role)
  AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
)
WITH CHECK (
  public.has_role(auth.uid(), 'manager'::public.app_role)
  AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
);