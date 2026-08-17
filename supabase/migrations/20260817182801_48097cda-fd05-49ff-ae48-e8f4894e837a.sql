-- 1) Diet plans: trainers only for assigned members in their visible branches
DROP POLICY IF EXISTS trainer_manage_diets ON public.diet_plans;

CREATE POLICY diet_plans_admin_manage ON public.diet_plans
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND (member_id IS NULL OR member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    ))
  )
  OR (
    has_role(auth.uid(), 'trainer'::app_role)
    AND member_id IS NOT NULL
    AND public.trainer_can_view_member(auth.uid(), member_id)
    AND member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND (member_id IS NULL OR member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    ))
  )
  OR (
    has_role(auth.uid(), 'trainer'::app_role)
    AND member_id IS NOT NULL
    AND public.trainer_can_view_member(auth.uid(), member_id)
    AND member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- 2) Member fitness plans: same restriction for trainers
DROP POLICY IF EXISTS "Staff can manage fitness plans" ON public.member_fitness_plans;

CREATE POLICY "Staff can manage fitness plans" ON public.member_fitness_plans
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (member_id IS NULL OR member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    ))
  )
  OR (
    has_role(auth.uid(), 'trainer'::app_role)
    AND member_id IS NOT NULL
    AND public.trainer_can_view_member(auth.uid(), member_id)
    AND member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (member_id IS NULL OR member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    ))
  )
  OR (
    has_role(auth.uid(), 'trainer'::app_role)
    AND member_id IS NOT NULL
    AND public.trainer_can_view_member(auth.uid(), member_id)
    AND member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- 3) Attachments bucket: branch-scoped staff reads
CREATE OR REPLACE FUNCTION public.can_read_attachment_object(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]) THEN true
      WHEN (storage.foldername(_object_name))[1] = 'fitness-plans' THEN
        EXISTS (
          SELECT 1 FROM public.members m
          WHERE m.id::text = (storage.foldername(_object_name))[2]
            AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
            AND (
              has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
              OR (has_role(auth.uid(), 'trainer'::app_role) AND public.trainer_can_view_member(auth.uid(), m.id))
            )
        )
      ELSE
        has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND EXISTS (SELECT 1 FROM (SELECT user_visible_branch_ids(auth.uid()) AS b) x WHERE x.b IS NOT NULL)
    END;
$$;

REVOKE ALL ON FUNCTION public.can_read_attachment_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_attachment_object(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Attachments access control" ON storage.objects;

CREATE POLICY "Attachments access control" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (owner = auth.uid() OR public.can_read_attachment_object(name))
);