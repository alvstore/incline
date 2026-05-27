
-- Scope contacts SELECT to caller's visible branches (owner/admin keep full access via user_visible_branch_ids)
DROP POLICY IF EXISTS contacts_select_staff ON public.contacts;
CREATE POLICY contacts_select_staff ON public.contacts
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  );

DROP POLICY IF EXISTS contacts_update_staff ON public.contacts;
CREATE POLICY contacts_update_staff ON public.contacts
  FOR UPDATE TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  );

DROP POLICY IF EXISTS contacts_write_staff ON public.contacts;
CREATE POLICY contacts_write_staff ON public.contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  );

-- communication_logs: drop unscoped ALL policy; replace with scoped write policies, keep branch-scoped SELECT
DROP POLICY IF EXISTS staff_access_comm_logs ON public.communication_logs;
CREATE POLICY staff_insert_comm_logs ON public.communication_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
  );
CREATE POLICY staff_update_comm_logs ON public.communication_logs
  FOR UPDATE TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  );
CREATE POLICY staff_delete_comm_logs ON public.communication_logs
  FOR DELETE TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
  );

-- ai_tool_logs: scope SELECT to visible branches (allow NULL branch — system logs)
DROP POLICY IF EXISTS "Staff can view AI tool logs" ON public.ai_tool_logs;
CREATE POLICY "Staff can view AI tool logs" ON public.ai_tool_logs
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
  );

-- contact_segments: scope to visible branches
DROP POLICY IF EXISTS segments_staff_all ON public.contact_segments;
CREATE POLICY segments_staff_all ON public.contact_segments
  FOR ALL TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  );

-- sms_logs: scope SELECT to visible branches (allow NULL — legacy/system rows)
DROP POLICY IF EXISTS "Staff+ can view sms logs" ON public.sms_logs;
CREATE POLICY "Staff+ can view sms logs" ON public.sms_logs
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role])
        AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
  );
