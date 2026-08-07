DROP POLICY IF EXISTS automation_rules_write ON public.automation_rules;
CREATE POLICY automation_rules_write ON public.automation_rules
FOR ALL TO authenticated
USING (
  has_capability(auth.uid(), 'manage_automations')
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (branch_id IS NOT NULL AND branch_id = get_user_branch(auth.uid()))
  )
)
WITH CHECK (
  has_capability(auth.uid(), 'manage_automations')
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (branch_id IS NOT NULL AND branch_id = get_user_branch(auth.uid()))
  )
);

DROP POLICY IF EXISTS ig_campaigns_write ON public.ig_comment_campaigns;
CREATE POLICY ig_campaigns_write ON public.ig_comment_campaigns
FOR ALL TO authenticated
USING (
  has_capability(auth.uid(), 'manage_automations')
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (branch_id IS NOT NULL AND branch_id = get_user_branch(auth.uid()))
  )
)
WITH CHECK (
  has_capability(auth.uid(), 'manage_automations')
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (branch_id IS NOT NULL AND branch_id = get_user_branch(auth.uid()))
  )
);