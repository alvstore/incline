DROP POLICY IF EXISTS "Staff read profiles in their branches" ON public.profiles;

CREATE POLICY "Staff read profiles in their branches"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND (
      id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.user_id = profiles.id
          AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.user_id = profiles.id
          AND e.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
      OR EXISTS (
        SELECT 1 FROM public.trainers t
        WHERE t.user_id = profiles.id
          AND t.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
    )
  )
);