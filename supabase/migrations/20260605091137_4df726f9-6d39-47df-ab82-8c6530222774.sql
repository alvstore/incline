-- discount_redemptions
DROP POLICY IF EXISTS discount_redemptions_staff_all ON public.discount_redemptions;
CREATE POLICY discount_redemptions_owner_admin_all
  ON public.discount_redemptions
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY discount_redemptions_branch_staff_all
  ON public.discount_redemptions
  FOR ALL
  TO authenticated
  USING (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

-- discount_redemption_attempts
DROP POLICY IF EXISTS discount_attempts_staff_all ON public.discount_redemption_attempts;
CREATE POLICY discount_attempts_owner_admin_all
  ON public.discount_redemption_attempts
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY discount_attempts_branch_staff_all
  ON public.discount_redemption_attempts
  FOR ALL
  TO authenticated
  USING (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

-- follow_up_activities
DROP POLICY IF EXISTS "Staff can manage follow-ups" ON public.follow_up_activities;
CREATE POLICY follow_ups_owner_admin_all
  ON public.follow_up_activities
  FOR ALL
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]));
CREATE POLICY follow_ups_branch_staff_all
  ON public.follow_up_activities
  FOR ALL
  TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

-- payment_transactions (SELECT only)
DROP POLICY IF EXISTS "Staff can view payment transactions" ON public.payment_transactions;
CREATE POLICY payment_transactions_owner_admin_select
  ON public.payment_transactions
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY payment_transactions_branch_staff_select
  ON public.payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    (has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role))
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );