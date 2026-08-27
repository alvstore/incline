DROP POLICY IF EXISTS staff_access_staff_attendance ON public.staff_attendance;

CREATE POLICY staff_access_staff_attendance
ON public.staff_attendance
FOR ALL
TO authenticated
USING (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);