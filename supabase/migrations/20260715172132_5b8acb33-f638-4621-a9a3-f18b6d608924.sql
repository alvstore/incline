
-- 1. access_devices
ALTER TABLE public.access_devices
  ADD COLUMN IF NOT EXISTS door_role text NOT NULL DEFAULT 'both'
    CHECK (door_role IN ('entry','exit','both')),
  ADD COLUMN IF NOT EXISTS last_reconcile_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_access_devices_branch_role_online
  ON public.access_devices (branch_id, door_role) WHERE is_online = true;

-- 2. campaigns.fallback_policy
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS fallback_policy jsonb NOT NULL DEFAULT '{"on_pacing": true}'::jsonb;

-- 3. campaign_recipients: track fallback usage
ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS fallback_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fallback_channel text,
  ADD COLUMN IF NOT EXISTS pacing_code int;

-- ============================================================
-- Security fixes: branch-scope staff policies
-- Uses (SELECT ARRAY(SELECT ...)) to materialise SETOF into array.
-- ============================================================

-- 4. biometric_sync_queue
DROP POLICY IF EXISTS "Staff can manage sync queue" ON public.biometric_sync_queue;
DROP POLICY IF EXISTS "Staff can view sync queue" ON public.biometric_sync_queue;

CREATE POLICY "Owners admins managers manage sync queue"
  ON public.biometric_sync_queue
  FOR ALL
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]));

CREATE POLICY "Branch staff manage sync queue in their branches"
  ON public.biometric_sync_queue
  FOR ALL
  USING (
    has_any_role(auth.uid(), ARRAY['staff'::app_role])
    AND (
      device_id IN (
        SELECT ad.id FROM public.access_devices ad
        WHERE ad.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR member_id IN (
        SELECT m.id FROM public.members m
        WHERE m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR staff_id IN (
        SELECT e.id FROM public.employees e
        WHERE e.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
    )
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['staff'::app_role])
    AND (
      device_id IN (
        SELECT ad.id FROM public.access_devices ad
        WHERE ad.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR member_id IN (
        SELECT m.id FROM public.members m
        WHERE m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      OR staff_id IN (
        SELECT e.id FROM public.employees e
        WHERE e.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
    )
  );

-- 5. device_access_events
DROP POLICY IF EXISTS "Staff can view access events" ON public.device_access_events;
DROP POLICY IF EXISTS "System insert access events" ON public.device_access_events;

CREATE POLICY "Owners admins managers view access events"
  ON public.device_access_events
  FOR SELECT
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]));

CREATE POLICY "Branch staff view access events in their branches"
  ON public.device_access_events
  FOR SELECT
  USING (
    has_any_role(auth.uid(), ARRAY['staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  );

CREATE POLICY "Owners admins managers insert access events"
  ON public.device_access_events
  FOR INSERT
  TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]));

CREATE POLICY "Branch staff insert access events in their branches"
  ON public.device_access_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  );

-- 6. member_documents
DROP POLICY IF EXISTS "Staff can manage documents" ON public.member_documents;

CREATE POLICY "Owners admins managers manage documents"
  ON public.member_documents
  FOR ALL
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]));

CREATE POLICY "Branch staff manage documents in their branches"
  ON public.member_documents
  FOR ALL
  USING (
    has_any_role(auth.uid(), ARRAY['staff'::app_role])
    AND member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['staff'::app_role])
    AND member_id IN (
      SELECT m.id FROM public.members m
      WHERE m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  );
