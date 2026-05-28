
-- access_logs
DROP POLICY IF EXISTS "Staff can view access logs" ON public.access_logs;
CREATE POLICY "Staff can view access logs" ON public.access_logs
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- campaigns
DROP POLICY IF EXISTS "Staff can view campaigns in their branch" ON public.campaigns;
CREATE POLICY "Staff can view campaigns in their branch" ON public.campaigns
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "Staff can create campaigns" ON public.campaigns;
CREATE POLICY "Staff can create campaigns" ON public.campaigns
FOR INSERT WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "Staff can update campaigns" ON public.campaigns;
CREATE POLICY "Staff can update campaigns" ON public.campaigns
FOR UPDATE USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- campaign_recipients: remove NULL branch_id leak for manager/staff
DROP POLICY IF EXISTS campaign_recipients_staff ON public.campaign_recipients;
CREATE POLICY campaign_recipients_staff ON public.campaign_recipients
FOR ALL USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_recipients.campaign_id
        AND c.branch_id IS NOT NULL
        AND c.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_recipients.campaign_id
        AND c.branch_id IS NOT NULL
        AND c.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- discount_codes
DROP POLICY IF EXISTS "Staff read discount codes" ON public.discount_codes;
CREATE POLICY "Staff read discount codes" ON public.discount_codes
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "Staff can manage discount codes" ON public.discount_codes;
CREATE POLICY "Staff can manage discount codes" ON public.discount_codes
FOR ALL USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_role(auth.uid(),'manager'::app_role)
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_role(auth.uid(),'manager'::app_role)
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- member_fitness_plans: scope managers + trainers to branches of members
DROP POLICY IF EXISTS "Staff can manage fitness plans" ON public.member_fitness_plans;
CREATE POLICY "Staff can manage fitness plans" ON public.member_fitness_plans
FOR ALL USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'trainer'::app_role])
    AND (
      member_id IS NULL
      OR member_id IN (
        SELECT m.id FROM members m
        WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
    )
  )
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'trainer'::app_role])
    AND (
      member_id IS NULL
      OR member_id IN (
        SELECT m.id FROM members m
        WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
    )
  )
);

-- reminder_configurations
DROP POLICY IF EXISTS "Staff can view reminder configs" ON public.reminder_configurations;
CREATE POLICY "Staff can view reminder configs" ON public.reminder_configurations
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
);

-- retention_nudge_logs
DROP POLICY IF EXISTS "Staff and above can view nudge logs" ON public.retention_nudge_logs;
CREATE POLICY "Staff and above can view nudge logs" ON public.retention_nudge_logs
FOR SELECT USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "Staff and above can manage nudge logs" ON public.retention_nudge_logs;
CREATE POLICY "Staff and above can manage nudge logs" ON public.retention_nudge_logs
FOR ALL USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
) WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);
