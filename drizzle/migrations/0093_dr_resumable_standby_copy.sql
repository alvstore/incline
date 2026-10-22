-- Resumable 1:1 standby copy: run tracking, owner controls, wake-on-queue worker,
-- nightly queue (02:30 IST) and an hourly watchdog that only wakes a stalled copy.
ALTER TABLE private.dr_config ADD COLUMN IF NOT EXISTS worker_url text;
UPDATE private.dr_config c
   SET worker_url = j.url
  FROM (SELECT substring(command from $re$url\s*:=\s*'([^']+)'$re$) AS url
          FROM cron.job
         WHERE jobname IN ('dr-replicate-rows','dr-replicate-schema','dr-replicate-auth','dr-replicate-storage')
           AND command ~ 'dr-replicate'
         LIMIT 1) j
 WHERE c.id = true AND c.worker_url IS NULL AND j.url IS NOT NULL;

CREATE TABLE IF NOT EXISTS private.dr_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'full' CHECK (kind IN ('full','verify')),
  trigger text NOT NULL DEFAULT 'nightly' CHECK (trigger IN ('nightly','manual')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','drift','failed','cancelled')),
  step text NOT NULL DEFAULT 'prepare',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid,
  ticks integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz
);
GRANT ALL ON private.dr_sync_runs TO service_role;
REVOKE ALL ON private.dr_sync_runs FROM PUBLIC, anon, authenticated;
ALTER TABLE private.dr_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny all direct access" ON private.dr_sync_runs AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- One active run at a time (also backs the watchdog gate).
CREATE UNIQUE INDEX IF NOT EXISTS dr_sync_runs_one_active ON private.dr_sync_runs ((true)) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS dr_sync_runs_created_idx ON private.dr_sync_runs (created_at DESC);

CREATE OR REPLACE FUNCTION private.dr_wake_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
-- guard-exempt: background helper; EXECUTE revoked from signed-in users.
DECLARE
  c record;
BEGIN
  SELECT worker_url, token INTO c FROM private.dr_config WHERE id = true;
  IF c.worker_url IS NULL OR c.token IS NULL THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := c.worker_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dr-secret', c.token),
    body := '{"mode":"tick"}'::jsonb,
    timeout_milliseconds := 30000);
END
$fn$;
REVOKE ALL ON FUNCTION private.dr_wake_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.dr_wake_worker() TO service_role;

CREATE OR REPLACE FUNCTION private.dr_queue_run(p_kind text, p_trigger text, p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
-- guard-exempt: background helper for pg_cron and dr_request_sync; EXECUTE revoked from signed-in users.
DECLARE
  v_id uuid;
BEGIN
  IF p_kind NOT IN ('full','verify') OR p_trigger NOT IN ('nightly','manual') THEN
    RAISE EXCEPTION 'invalid standby copy request';
  END IF;
  SELECT id INTO v_id FROM private.dr_sync_runs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  BEGIN
    INSERT INTO private.dr_sync_runs (kind, trigger, requested_by) VALUES (p_kind, p_trigger, p_user) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id FROM private.dr_sync_runs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1;
    RETURN v_id;
  END;
  PERFORM private.dr_wake_worker(); -- sent after commit by pg_net
  RETURN v_id;
END
$fn$;
REVOKE ALL ON FUNCTION private.dr_queue_run(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.dr_queue_run(text, text, uuid) TO service_role;

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
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'owner') THEN
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
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'owner') THEN
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

-- Schedules: queue the nightly copy (daily) and an hourly watchdog that only wakes the
-- worker when a copy has gone quiet for 10 minutes. The four fixed-time passes go away.
DO $do$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
    WHERE jobname IN ('dr-replicate-schema','dr-replicate-auth','dr-replicate-rows','dr-replicate-storage');
  PERFORM cron.schedule('dr-sync-nightly', '0 21 * * *', $c$SELECT private.dr_queue_run('full', 'nightly', NULL)$c$);
  PERFORM cron.schedule('dr-sync-watchdog', '17 * * * *',
    $c$SELECT private.dr_wake_worker() WHERE EXISTS (SELECT 1 FROM private.dr_sync_runs WHERE status IN ('queued','running') AND coalesce(heartbeat_at, created_at) < now() - interval '10 minutes')$c$);
END
$do$;
