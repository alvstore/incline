
-- Branch-scope previously org-wide staff/manager policies.

-- 1. benefit_usage (via memberships.branch_id)
DROP POLICY IF EXISTS staff_access_benefit_usage ON public.benefit_usage;
CREATE POLICY staff_access_benefit_usage ON public.benefit_usage
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = benefit_usage.membership_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = benefit_usage.membership_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

-- 2. equipment (direct branch_id)
DROP POLICY IF EXISTS staff_access_equipment ON public.equipment;
CREATE POLICY staff_access_equipment ON public.equipment
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

-- 3. equipment_maintenance (via equipment.branch_id)
DROP POLICY IF EXISTS staff_access_maintenance ON public.equipment_maintenance;
CREATE POLICY staff_access_maintenance ON public.equipment_maintenance
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.equipment e
      WHERE e.id = equipment_maintenance.equipment_id
        AND e.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.equipment e
      WHERE e.id = equipment_maintenance.equipment_id
        AND e.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

-- 4. lead_followups (via leads.branch_id)
DROP POLICY IF EXISTS staff_access_leads_followups ON public.lead_followups;
CREATE POLICY staff_access_leads_followups ON public.lead_followups
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_followups.lead_id
        AND (l.branch_id IS NULL OR l.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_followups.lead_id
        AND (l.branch_id IS NULL OR l.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
    )
  )
);

-- 5. member_branch_history (from/to branch)
DROP POLICY IF EXISTS staff_access_member_branch_history ON public.member_branch_history;
CREATE POLICY staff_access_member_branch_history ON public.member_branch_history
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND (
      from_branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      OR to_branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND (
      from_branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      OR to_branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

-- 6. membership_free_days (via memberships.branch_id)
DROP POLICY IF EXISTS staff_access_free_days ON public.membership_free_days;
CREATE POLICY staff_access_free_days ON public.membership_free_days
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = membership_free_days.membership_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = membership_free_days.membership_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS staff_read_membership_free_days ON public.membership_free_days;
CREATE POLICY staff_read_membership_free_days ON public.membership_free_days
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = membership_free_days.membership_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

-- 7. membership_freeze_history (via memberships.branch_id)
DROP POLICY IF EXISTS staff_access_freeze_history ON public.membership_freeze_history;
CREATE POLICY staff_access_freeze_history ON public.membership_freeze_history
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = membership_freeze_history.membership_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.id = membership_freeze_history.membership_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);
