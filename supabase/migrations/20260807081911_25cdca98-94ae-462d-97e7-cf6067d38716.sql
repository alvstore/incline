DROP POLICY IF EXISTS "ai_purposes_write_admin" ON public.ai_purposes;

CREATE POLICY "ai_purposes_write_admin"
ON public.ai_purposes
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'owner'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND branch_id IS NOT NULL
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_role(auth.uid(), 'owner'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND branch_id IS NOT NULL
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);