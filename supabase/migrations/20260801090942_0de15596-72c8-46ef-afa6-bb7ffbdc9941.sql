ALTER TABLE public.howbody_posture_reports
  ADD COLUMN IF NOT EXISTS posture_type text,
  ADD COLUMN IF NOT EXISTS body_shape_profile text;

DROP POLICY IF EXISTS "Members can create their own plan requests" ON public.tasks;
CREATE POLICY "Members can create their own plan requests"
ON public.tasks
FOR INSERT
TO authenticated
WITH CHECK (
  assigned_by = auth.uid()
  AND linked_entity_type = 'member'
  AND EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.id = tasks.linked_entity_id
      AND m.user_id = auth.uid()
      AND m.branch_id = tasks.branch_id
  )
);

GRANT INSERT ON public.tasks TO authenticated;