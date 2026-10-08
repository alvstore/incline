-- 0019 — Database performance follow-up (2026-10-08 audit)
-- 1. access_logs: nightly safety net that strips gate-camera base64 captures from
--    the JSONB payload (85% of database size; nothing in the app reads them).
-- 2. RLS hot paths: hoist per-row has_any_role/get_user_branch/manages_branch calls
--    into (SELECT …) InitPlans so they run once per statement, not once per row.
--    Semantics are unchanged; only evaluation count changes.
-- 3. Tiny partial index for the sidebar unread-chat badge.

-- ---------------------------------------------------------------------------
-- 1. access_logs media retention
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_access_log_media(
  p_older_than interval DEFAULT interval '1 day',
  p_batch integer DEFAULT 1000,
  p_max_batches integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer := 0;
  v_n integer;
  v_i integer := 0;
BEGIN
  -- guard-exempt: background-only maintenance; EXECUTE is revoked from PUBLIC/anon/authenticated below.
  LOOP
    WITH victims AS (
      SELECT id
      FROM public.access_logs
      WHERE created_at < now() - p_older_than
        AND payload IS NOT NULL
        AND pg_column_size(payload) > 4096
        AND NOT (payload ? 'media_stripped_at')
      ORDER BY created_at
      LIMIT p_batch
      FOR UPDATE SKIP LOCKED
    ), stripped AS (
      SELECT a.id,
             COALESCE(
               (SELECT jsonb_object_agg(e.key, e.value)
                  FROM jsonb_each(a.payload) e
                 WHERE pg_column_size(e.value) <= 2048),
               '{}'::jsonb
             )
             || jsonb_build_object(
                  'media_stripped_at', now(),
                  'media_bytes_removed', pg_column_size(a.payload)
                ) AS new_payload
      FROM public.access_logs a
      JOIN victims v USING (id)
    )
    UPDATE public.access_logs a
       SET payload = s.new_payload
      FROM stripped s
     WHERE a.id = s.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    v_i := v_i + 1;
    EXIT WHEN v_n < p_batch OR v_i >= p_max_batches;
  END LOOP;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_access_log_media(interval, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_access_log_media(interval, integer, integer) TO service_role;
COMMENT ON FUNCTION public.prune_access_log_media(interval, integer, integer) IS
  'Strips oversized values (gate camera base64 captures) from access_logs.payload for rows older than p_older_than. Rows are kept; only media blobs are removed. Background-only.';

-- Wire into the existing 6-hourly maintenance job (same body as before + the new call).
CREATE OR REPLACE FUNCTION public.maintain_log_sizes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    -- guard-exempt: pg_cron-only maintenance; EXECUTE revoked from PUBLIC/anon/authenticated.
    -- Retention policies (aggressive for high-volume logs)

    -- Webhook failures: keep last 3 days
    DELETE FROM public.webhook_failures WHERE created_at < now() - interval '3 days';

    -- Automation runs: keep last 5 days
    DELETE FROM public.automation_runs WHERE started_at < now() - interval '5 days';

    -- Communication logs: keep 15 days
    DELETE FROM public.communication_logs WHERE created_at < now() - interval '15 days';

    -- Retry queue: Keep recent successes (last 2 days)
    DELETE FROM public.communication_retry_queue
    WHERE created_at < now() - interval '2 days'
    AND status IN ('completed', 'failed_permanent');

    -- System health pings: Keep only 24 hours of history (observed_at)
    DELETE FROM public.system_health_pings WHERE observed_at < now() - interval '1 day';

    -- Audit logs: Keep 30 days
    DELETE FROM public.audit_logs WHERE created_at < now() - interval '30 days';

    -- Notifications: Keep 15 days
    DELETE FROM public.notifications WHERE created_at < now() - interval '15 days';

    -- Gate access logs: keep every row, drop camera captures older than 1 day
    PERFORM public.prune_access_log_media(interval '1 day', 1000, 50);
END;
$function$;

REVOKE ALL ON FUNCTION public.maintain_log_sizes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.maintain_log_sizes() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. RLS hot paths — hoist per-row helper calls
-- ---------------------------------------------------------------------------
-- Set-returning twin of manages_branch(): the branches a user manages via
-- branch_managers. Lets a policy use `branch_id IN (SELECT …)` (hashed once)
-- instead of calling manages_branch(uid, branch_id) for every row.
CREATE OR REPLACE FUNCTION public.managed_branch_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bm.branch_id
  FROM public.branch_managers bm
  WHERE bm.user_id = _user_id
    AND (
      _user_id IS NOT DISTINCT FROM auth.uid()
      OR NOT public.rpc_guard_applies('managed_branch_ids')
      OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[])
    );
$$;

REVOKE ALL ON FUNCTION public.managed_branch_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.managed_branch_ids(uuid) TO authenticated, service_role;

-- member_attendance ----------------------------------------------------------
DROP POLICY IF EXISTS "Staff manage attendance" ON public.member_attendance;
CREATE POLICY "Staff manage attendance" ON public.member_attendance
  FOR ALL TO authenticated
  USING (
    (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[]))
    AND (
      branch_id = (SELECT public.get_user_branch(auth.uid()))
      OR (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]))
      OR branch_id IN (SELECT public.managed_branch_ids(auth.uid()))
    )
  )
  WITH CHECK (
    (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[]))
    AND (
      branch_id = (SELECT public.get_user_branch(auth.uid()))
      OR (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]))
      OR branch_id IN (SELECT public.managed_branch_ids(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "View own attendance" ON public.member_attendance;
CREATE POLICY "View own attendance" ON public.member_attendance
  FOR SELECT TO public
  USING (member_id = (SELECT public.get_member_id(auth.uid())));

-- whatsapp_chat_settings -----------------------------------------------------
DROP POLICY IF EXISTS "Staff can view chat settings" ON public.whatsapp_chat_settings;
CREATE POLICY "Staff can view chat settings" ON public.whatsapp_chat_settings
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]))
    OR (
      (SELECT public.has_any_role(auth.uid(), ARRAY['manager','staff','trainer']::public.app_role[]))
      AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
    )
  );

DROP POLICY IF EXISTS "Staff can update chat settings" ON public.whatsapp_chat_settings;
CREATE POLICY "Staff can update chat settings" ON public.whatsapp_chat_settings
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]))
    OR (
      (SELECT public.has_any_role(auth.uid(), ARRAY['manager','staff','trainer']::public.app_role[]))
      AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
    )
  );

DROP POLICY IF EXISTS "Staff can insert chat settings" ON public.whatsapp_chat_settings;
CREATE POLICY "Staff can insert chat settings" ON public.whatsapp_chat_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[]))
  );

-- access_logs ----------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can view access logs" ON public.access_logs;
CREATE POLICY "Staff can view access logs" ON public.access_logs
  FOR SELECT TO public
  USING (
    (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]))
    OR (
      (SELECT public.has_any_role(auth.uid(), ARRAY['manager','staff']::public.app_role[]))
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Sidebar unread badge: count(*) WHERE is_unread = true, policy reads branch_id
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wcs_unread_branch
  ON public.whatsapp_chat_settings (branch_id)
  WHERE is_unread = true;