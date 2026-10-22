-- Standby-copy controls are an explicit owner capability (mirrors can.manageStandbyCopy).
INSERT INTO public.role_capabilities (role, capability)
SELECT 'owner'::public.app_role, 'manage_standby_copy'
WHERE NOT EXISTS (SELECT 1 FROM public.role_capabilities WHERE role = 'owner'::public.app_role AND capability = 'manage_standby_copy');

CREATE OR REPLACE FUNCTION public.dr_request_sync(p_kind text DEFAULT 'full')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL OR NOT public.has_capability(v_uid, 'manage_standby_copy') THEN
    RAISE EXCEPTION 'Only the owner can start a standby copy' USING ERRCODE = '42501';
  END IF;
  v_id := private.dr_queue_run(coalesce(p_kind, 'full'), 'manual', v_uid);
  RETURN (SELECT jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status) FROM private.dr_sync_runs r WHERE r.id = v_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.dr_request_sync(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dr_request_sync(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dr_sync_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_capability(v_uid, 'manage_standby_copy') THEN
    RAISE EXCEPTION 'Only the owner can view standby copies' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'latest', (SELECT to_jsonb(x) FROM (
        SELECT id, kind, trigger, status, step, report, ticks, created_at, started_at, heartbeat_at, finished_at
        FROM private.dr_sync_runs ORDER BY created_at DESC LIMIT 1) x),
    'lastFull', (SELECT to_jsonb(x) FROM (
        SELECT id, kind, trigger, status, report, created_at, started_at, finished_at
        FROM private.dr_sync_runs WHERE kind = 'full' AND status IN ('succeeded','drift') ORDER BY created_at DESC LIMIT 1) x),
    'history', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb) FROM (
        SELECT id, kind, trigger, status, created_at, started_at, finished_at,
               (report -> 'verify' ->> 'allInSync')::boolean AS in_sync
        FROM private.dr_sync_runs ORDER BY created_at DESC LIMIT 8) x)
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.dr_sync_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dr_sync_status() TO authenticated, service_role;
