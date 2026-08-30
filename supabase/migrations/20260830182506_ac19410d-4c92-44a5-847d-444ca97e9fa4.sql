CREATE OR REPLACE FUNCTION public.voice_ops_summary(p_branch uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_branches uuid[];
  v_cfg jsonb;
  v_active boolean;
  v_retention jsonb;
  v_today jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff']::app_role[]) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT array_agg(b) INTO v_branches FROM public.user_visible_branch_ids(v_uid) b;
  IF v_branches IS NULL THEN RETURN '{}'::jsonb; END IF;

  IF p_branch IS NOT NULL THEN
    IF NOT (p_branch = ANY (v_branches)) THEN RETURN '{}'::jsonb; END IF;
    v_branches := ARRAY[p_branch];
  END IF;

  SELECT vi.config, vi.is_active, vi.retention_automation
    INTO v_cfg, v_active, v_retention
  FROM public.voice_provider_integrations vi
  WHERE vi.provider = 'sarvam'
  ORDER BY vi.updated_at DESC NULLS LAST
  LIMIT 1;

  WITH today AS (
    SELECT v.* FROM public.voice_call_attempts v
    WHERE v.branch_id = ANY (v_branches)
      AND (coalesce(v.started_at, v.created_at) AT TIME ZONE 'Asia/Kolkata')::date
          = (now() AT TIME ZONE 'Asia/Kolkata')::date
  )
  SELECT jsonb_build_object(
    'calls', count(*),
    'connected', count(*) FILTER (WHERE t.status IN ('answered','in_progress','completed')),
    'completed', count(*) FILTER (WHERE t.status = 'completed'),
    'no_answer', count(*) FILTER (WHERE t.status = 'no_answer'),
    'failed', count(*) FILTER (WHERE t.status IN ('failed','busy','cancelled')),
    'in_progress', count(*) FILTER (WHERE t.status IN ('queued','initiated','ringing','answered','in_progress')),
    'coming_back', count(*) FILTER (WHERE t.disposition = 'coming_back'),
    'callbacks', count(*) FILTER (WHERE t.disposition = 'callback_requested'),
    'complaints', count(*) FILTER (WHERE t.disposition = 'complaint'),
    'dnd_requests', count(*) FILTER (WHERE t.disposition = 'wrong_person')
  ) INTO v_today
  FROM today t;

  RETURN jsonb_build_object(
    'today', coalesce(v_today, '{}'::jsonb),
    'integration', jsonb_build_object(
      'provider', 'sarvam',
      'is_active', coalesce(v_active, false),
      'agent_id', v_cfg ->> 'app_id',
      'agent_version', v_cfg ->> 'app_version',
      'agent_phone_number', v_cfg ->> 'agent_phone_number',
      'window_start', coalesce(v_cfg ->> 'window_start', '10:00'),
      'window_end', coalesce(v_cfg ->> 'window_end', '19:00'),
      'daily_call_cap', coalesce((v_retention ->> 'max_calls_per_day')::int, (v_cfg ->> 'daily_call_cap')::int, 25),
      'retention_enabled', coalesce((v_retention ->> 'enabled')::boolean, false),
      'min_absent_days', coalesce((v_retention ->> 'min_absent_days')::int, 7),
      'cooldown_days', coalesce((v_retention ->> 'cooldown_days')::int, 7)
    ),
    'now_ist', to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.voice_ops_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voice_ops_summary(uuid) TO authenticated;