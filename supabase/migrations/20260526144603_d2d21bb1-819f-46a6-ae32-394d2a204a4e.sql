
-- ============ TRAINERS: branch-scope manager/staff access ============
DROP POLICY IF EXISTS "Admin manage trainers" ON public.trainers;
DROP POLICY IF EXISTS "Admins view all trainers" ON public.trainers;
DROP POLICY IF EXISTS "Staff view active trainers" ON public.trainers;

CREATE POLICY "Owners admins view all trainers"
ON public.trainers FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers view branch trainers"
ON public.trainers FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);

CREATE POLICY "Staff view branch active trainers"
ON public.trainers FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'staff'::app_role)
  AND is_active = true
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);

CREATE POLICY "Owners admins manage all trainers"
ON public.trainers FOR ALL TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Managers manage branch trainers"
ON public.trainers FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);

-- ============ PAYROLL_ITEMS: scope via payroll_runs.branch_id ============
DROP POLICY IF EXISTS payroll_items_admin_all ON public.payroll_items;

CREATE POLICY payroll_items_owner_admin_all
ON public.payroll_items FOR ALL TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY payroll_items_manager_branch
ON public.payroll_items FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND run_id IN (
    SELECT id FROM public.payroll_runs
    WHERE branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND run_id IN (
    SELECT id FROM public.payroll_runs
    WHERE branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- ============ CAMPAIGN_RUNS: scope via campaigns.branch_id ============
DROP POLICY IF EXISTS "Staff can view campaign runs" ON public.campaign_runs;

CREATE POLICY "Owners admins view all campaign runs"
ON public.campaign_runs FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "Staff view branch campaign runs"
ON public.campaign_runs FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
  AND campaign_id IN (
    SELECT id FROM public.campaigns
    WHERE branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- ============ DISCOUNT_CODES: branch-scope member reads ============
DROP POLICY IF EXISTS "Members can read active discount codes" ON public.discount_codes;

CREATE POLICY "Members read own branch active codes"
ON public.discount_codes FOR SELECT TO authenticated
USING (
  is_active = true
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    OR branch_id = (SELECT branch_id FROM public.members WHERE user_id = auth.uid() LIMIT 1)
  )
);
