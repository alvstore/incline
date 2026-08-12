DROP POLICY IF EXISTS "branch staff read comm prefs" ON public.member_communication_preferences;

CREATE POLICY "branch staff read comm prefs"
ON public.member_communication_preferences
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    is_branch_member(branch_id)
    AND has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
  )
);