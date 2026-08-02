DROP POLICY IF EXISTS "Members and trainers view active branches" ON public.branches;

CREATE POLICY "Members and trainers view own branch"
ON public.branches
FOR SELECT
TO authenticated
USING (
  is_active = true
  AND (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.branch_id = branches.id
    )
    OR EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.user_id = auth.uid() AND t.branch_id = branches.id
    )
  )
);