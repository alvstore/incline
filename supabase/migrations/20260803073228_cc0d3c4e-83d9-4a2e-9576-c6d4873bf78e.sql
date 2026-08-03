DROP POLICY "Members can view own feedback" ON public.feedback;
CREATE POLICY "Members can view own feedback" ON public.feedback
FOR SELECT USING (
  member_id IN (SELECT members.id FROM public.members WHERE members.user_id = auth.uid())
);

DROP POLICY "Staff manage tasks" ON public.tasks;
CREATE POLICY "Staff manage tasks" ON public.tasks
FOR ALL USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND (
      manages_branch(auth.uid(), branch_id)
      OR branch_id = ANY (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND (
      manages_branch(auth.uid(), branch_id)
      OR branch_id = ANY (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);