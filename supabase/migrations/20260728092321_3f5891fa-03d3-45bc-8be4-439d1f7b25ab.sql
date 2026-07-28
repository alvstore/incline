
-- ai_call_logs
DROP POLICY IF EXISTS staff_view_ai_call_logs ON public.ai_call_logs;
CREATE POLICY staff_view_ai_call_logs ON public.ai_call_logs
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_role(auth.uid(),'manager'::app_role)
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

-- google_reviews
DROP POLICY IF EXISTS "Staff can view google reviews" ON public.google_reviews;
CREATE POLICY "Staff can view google reviews" ON public.google_reviews
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

-- hardware_devices
DROP POLICY IF EXISTS "Staff can view hardware devices" ON public.hardware_devices;
CREATE POLICY "Staff can view hardware devices" ON public.hardware_devices
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

-- webhook_failures
DROP POLICY IF EXISTS "Admins can view webhook failures" ON public.webhook_failures;
CREATE POLICY "Admins can view webhook failures" ON public.webhook_failures
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(),'admin'::app_role)
  OR (
    has_role(auth.uid(),'manager'::app_role)
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

-- consent_events (scope managers by subject's branch)
DROP POLICY IF EXISTS "Owners admins managers can read consent events" ON public.consent_events;
CREATE POLICY "Owners admins managers can read consent events" ON public.consent_events
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  OR (
    has_role(auth.uid(),'manager'::app_role)
    AND (
      (subject_type = 'member' AND EXISTS (
         SELECT 1 FROM public.members m
         WHERE m.id = consent_events.subject_id
           AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      ))
      OR (subject_type = 'lead' AND EXISTS (
         SELECT 1 FROM public.leads l
         WHERE l.id = consent_events.subject_id
           AND l.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      ))
    )
  )
);
