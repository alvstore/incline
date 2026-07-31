DROP POLICY IF EXISTS leave_admin_all ON public.leave_requests;

CREATE POLICY leave_admin_all ON public.leave_requests
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'owner'::app_role)
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (
      EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.user_id = leave_requests.user_id
          AND e.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR EXISTS (
        SELECT 1 FROM public.trainers t
        WHERE t.user_id = leave_requests.user_id
          AND t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR EXISTS (
        SELECT 1 FROM public.staff_branches sb
        WHERE sb.user_id = leave_requests.user_id
          AND sb.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'owner'::app_role)
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND (
      EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.user_id = leave_requests.user_id
          AND e.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR EXISTS (
        SELECT 1 FROM public.trainers t
        WHERE t.user_id = leave_requests.user_id
          AND t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR EXISTS (
        SELECT 1 FROM public.staff_branches sb
        WHERE sb.user_id = leave_requests.user_id
          AND sb.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
    )
  )
);

DROP POLICY IF EXISTS admin_manage_commissions ON public.trainer_commissions;

CREATE POLICY admin_manage_commissions ON public.trainer_commissions
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = trainer_commissions.trainer_id
        AND t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = trainer_commissions.trainer_id
        AND t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS trainer_view_own_commissions ON public.trainer_commissions;

CREATE POLICY trainer_view_own_commissions ON public.trainer_commissions
FOR SELECT
TO authenticated
USING (
  trainer_id IN (SELECT id FROM public.trainers WHERE user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = trainer_commissions.trainer_id
        AND t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);