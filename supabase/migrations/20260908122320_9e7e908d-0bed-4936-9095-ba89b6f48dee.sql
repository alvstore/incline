DROP FUNCTION IF EXISTS public.voice_retention_candidates(integer, integer, uuid[]);

CREATE OR REPLACE FUNCTION public.voice_retention_candidates(
  _min_absent_days integer DEFAULT 7,
  _cooldown_days integer DEFAULT 7,
  _branch_ids uuid[] DEFAULT NULL::uuid[],
  _recent_contact_days integer DEFAULT 0
)
RETURNS TABLE(
  member_id uuid, branch_id uuid, phone text, last_seen timestamptz, last_call timestamptz,
  missing_phone boolean, dnd boolean, paused boolean, too_recent boolean,
  in_cooldown boolean, contacted_today boolean,
  no_visit_data boolean, recent_human_contact boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      m.id,
      m.branch_id,
      p.phone,
      coalesce(m.do_not_contact, false)
        OR EXISTS (
          SELECT 1 FROM public.whatsapp_chat_settings w
          WHERE w.phone_number = p.phone AND w.do_not_contact = true
        ) AS dnd,
      EXISTS (
        SELECT 1 FROM public.whatsapp_chat_settings w
        WHERE w.phone_number = p.phone
          AND (w.bot_active = false OR w.handoff_requested_at IS NOT NULL
               OR (w.bot_paused_until IS NOT NULL AND w.bot_paused_until > now()))
      ) AS paused,
      (SELECT max(a.check_in) FROM public.member_attendance a WHERE a.member_id = m.id) AS last_seen,
      (SELECT max(v.started_at) FROM public.voice_call_attempts v
        WHERE v.member_id = m.id AND v.source = 'member_retention'
          AND v.status NOT IN ('failed', 'cancelled')) AS last_call,
      (
        _recent_contact_days > 0 AND EXISTS (
          SELECT 1 FROM public.communication_logs c
          WHERE c.member_id = m.id
            AND c.created_at > now() - make_interval(days => _recent_contact_days)
        )
      ) AS recent_human_contact
    FROM public.members m
    JOIN public.branches b ON b.id = m.branch_id AND b.is_active = true
    LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.status = 'active'
      AND (_branch_ids IS NULL OR array_length(_branch_ids, 1) IS NULL OR m.branch_id = ANY (_branch_ids))
      AND EXISTS (
        SELECT 1 FROM public.memberships ms
        WHERE ms.member_id = m.id AND ms.status = 'active'
      )
  )
  SELECT
    id, branch_id, phone, last_seen, last_call,
    (phone IS NULL OR phone !~ '^\+91[6-9][0-9]{9}$') AS missing_phone,
    dnd,
    paused,
    (last_seen IS NOT NULL AND last_seen > now() - make_interval(days => _min_absent_days)) AS too_recent,
    (last_call IS NOT NULL AND last_call > now() - make_interval(days => greatest(_cooldown_days, 0))) AS in_cooldown,
    (last_call IS NOT NULL
      AND (last_call AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS contacted_today,
    (last_seen IS NULL) AS no_visit_data,
    recent_human_contact
  FROM base;
$function$;

GRANT EXECUTE ON FUNCTION public.voice_retention_candidates(integer, integer, uuid[], integer) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.voice_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  candidates_found integer NOT NULL DEFAULT 0,
  calls_attempted integer NOT NULL DEFAULT 0,
  calls_placed integer NOT NULL DEFAULT 0,
  calls_skipped integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  last_error text,
  skip_reason text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.voice_automation_runs TO authenticated;
GRANT ALL ON public.voice_automation_runs TO service_role;
ALTER TABLE public.voice_automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voice_runs_read_staff" ON public.voice_automation_runs;
CREATE POLICY "voice_runs_read_staff" ON public.voice_automation_runs
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'staff')
);

CREATE INDEX IF NOT EXISTS idx_voice_automation_runs_started ON public.voice_automation_runs (started_at DESC);

CREATE OR REPLACE FUNCTION public.voice_automation_claim_run(_lease_minutes integer DEFAULT 15)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('voice_retention_worker')) THEN
    RETURN NULL;
  END IF;

  UPDATE public.voice_automation_runs
     SET status = 'stale', finished_at = now(), last_error = 'Run exceeded its lease'
   WHERE status = 'running'
     AND started_at < now() - make_interval(mins => greatest(_lease_minutes, 1));

  IF EXISTS (SELECT 1 FROM public.voice_automation_runs WHERE status = 'running') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.voice_automation_runs (status) VALUES ('running') RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.voice_automation_claim_run(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.voice_automation_claim_run(integer) FROM anon;
REVOKE ALL ON FUNCTION public.voice_automation_claim_run(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.voice_automation_claim_run(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.voice_automation_health()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_last jsonb; v_success jsonb; v_rule jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'staff')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT to_jsonb(r) INTO v_last FROM (
    SELECT id, status, started_at, finished_at, candidates_found, calls_attempted,
           calls_placed, calls_skipped, error_count, last_error, skip_reason
      FROM public.voice_automation_runs ORDER BY started_at DESC LIMIT 1
  ) r;

  SELECT to_jsonb(r) INTO v_success FROM (
    SELECT id, started_at, finished_at, calls_placed, candidates_found
      FROM public.voice_automation_runs
     WHERE status IN ('completed', 'skipped')
     ORDER BY started_at DESC LIMIT 1
  ) r;

  SELECT to_jsonb(r) INTO v_rule FROM (
    SELECT key, is_active, cron_expression, last_run_at, next_run_at, last_status, last_error
      FROM public.automation_rules WHERE key = 'voice_retention_worker' LIMIT 1
  ) r;

  RETURN jsonb_build_object(
    'last_run', v_last,
    'last_success', v_success,
    'scheduler', v_rule,
    'now_ist', to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.voice_automation_health() TO authenticated;

INSERT INTO public.automation_rules (key, name, description, category, worker, worker_payload, cron_expression, is_active, is_system)
SELECT
  'voice_retention_worker',
  'Voice AI retention worker',
  'Places automated retention calls to absent members inside the configured IST calling window.',
  'retention',
  'edge:sarvam-voice',
  '{"action":"auto_tick"}'::jsonb,
  '*/10 * * * *',
  true,
  true
WHERE NOT EXISTS (SELECT 1 FROM public.automation_rules WHERE key = 'voice_retention_worker');