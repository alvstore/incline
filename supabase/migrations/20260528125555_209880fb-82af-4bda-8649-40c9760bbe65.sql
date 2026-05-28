
-- 1. communication_logs: members see only their own
DROP POLICY IF EXISTS "branch_scoped_comm_logs_select" ON public.communication_logs;
CREATE POLICY "comm_logs_select_scoped" ON public.communication_logs
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND branch_id IS NOT NULL
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  OR (member_id IS NOT NULL AND member_id = get_member_id(auth.uid()))
);

-- 2. howbody_body_reports: branch-scope staff/trainer access
DROP POLICY IF EXISTS "Staff reads body reports" ON public.howbody_body_reports;
CREATE POLICY "Staff reads body reports" ON public.howbody_body_reports
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- 3. howbody_posture_reports
DROP POLICY IF EXISTS "Staff reads posture reports" ON public.howbody_posture_reports;
CREATE POLICY "Staff reads posture reports" ON public.howbody_posture_reports
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- 4. benefit_settings: scope to visible branches, staff-only
DROP POLICY IF EXISTS "Staff can view benefit settings" ON public.benefit_settings;
CREATE POLICY "Staff can view benefit settings" ON public.benefit_settings
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
);

-- 5. discount_codes: remove member enumeration
DROP POLICY IF EXISTS "Members read own branch active codes" ON public.discount_codes;
CREATE POLICY "Staff read discount codes" ON public.discount_codes
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
);
