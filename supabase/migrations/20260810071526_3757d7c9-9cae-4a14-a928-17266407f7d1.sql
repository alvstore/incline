DROP POLICY IF EXISTS "Admin manage staff branches" ON public.staff_branches;

CREATE POLICY "Owner admin manage all staff branches"
ON public.staff_branches
FOR ALL
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Manager manage own branch staff"
ON public.staff_branches
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND branch_id IN (SELECT sb.branch_id FROM public.staff_branches sb WHERE sb.user_id = auth.uid())
)
WITH CHECK (
  public.has_role(auth.uid(), 'manager')
  AND branch_id IN (SELECT sb.branch_id FROM public.staff_branches sb WHERE sb.user_id = auth.uid())
);