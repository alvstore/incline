ALTER TABLE public.voice_call_attempts
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS eligible_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS voice_call_attempts_live_phone_uidx
  ON public.voice_call_attempts (provider, phone)
  WHERE status IN ('queued', 'initiated', 'ringing');

CREATE INDEX IF NOT EXISTS voice_call_attempts_member_started_idx
  ON public.voice_call_attempts (member_id, started_at DESC);

CREATE OR REPLACE FUNCTION public.voice_claim_call_slot(
  _provider text,
  _branch_id uuid,
  _source text,
  _reason text,
  _phone text,
  _member_id uuid,
  _lead_id uuid,
  _agent_id text,
  _agent_version int,
  _daily_cap int,
  _max_concurrent int,
  _cooldown_days int,
  _eligibility jsonb,
  _created_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_today int;
  v_live int;
  v_recent timestamptz;
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('voice_call_slot:' || coalesce(_provider, '')));

  SELECT count(*) INTO v_today
  FROM public.voice_call_attempts
  WHERE provider = _provider
    AND (started_at AT TIME ZONE 'Asia/Kolkata')::date
        = (now() AT TIME ZONE 'Asia/Kolkata')::date;

  IF v_today >= greatest(_daily_cap, 0) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'daily_cap_reached',
      'error', format('Daily call cap reached (%s of %s used today).', v_today, _daily_cap));
  END IF;

  SELECT count(*) INTO v_live
  FROM public.voice_call_attempts
  WHERE provider = _provider
    AND status IN ('queued', 'initiated', 'ringing');

  IF v_live >= greatest(_max_concurrent, 1) THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'concurrency_limit',
      'error', 'Another voice call is already in progress.');
  END IF;

  IF coalesce(_cooldown_days, 0) > 0 THEN
    SELECT max(started_at) INTO v_recent
    FROM public.voice_call_attempts
    WHERE provider = _provider
      AND phone = _phone
      AND source = _source
      AND status NOT IN ('failed', 'cancelled');
    IF v_recent IS NOT NULL AND v_recent > now() - make_interval(days => _cooldown_days) THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'cooldown_active',
        'error', format('Cooldown active - last call %s IST.', to_char(v_recent AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')));
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.voice_call_attempts (
      branch_id, provider, source, reason, phone, member_id, lead_id,
      agent_id, agent_version, status, eligibility_snapshot, eligible_at,
      started_at, created_by
    ) VALUES (
      _branch_id, _provider, _source, _reason, _phone, _member_id, _lead_id,
      _agent_id, _agent_version, 'queued', coalesce(_eligibility, '{}'::jsonb), now(),
      now(), _created_by
    ) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'duplicate_live_call',
      'error', 'A call to this number is already in progress.');
  END;

  RETURN jsonb_build_object('ok', true, 'attempt_row_id', v_id, 'used_today', v_today + 1);
END;
$fn$;

REVOKE ALL ON FUNCTION public.voice_claim_call_slot(text, uuid, text, text, text, uuid, uuid, text, int, int, int, int, jsonb, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.voice_claim_call_slot(text, uuid, text, text, text, uuid, uuid, text, int, int, int, int, jsonb, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.voice_retention_eligibility(
  _min_absent_days int DEFAULT 7,
  _cooldown_days int DEFAULT 7,
  _daily_cap int DEFAULT 25,
  _window_start text DEFAULT '10:00',
  _window_end text DEFAULT '19:00',
  _branch_ids uuid[] DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_now_ist timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_in_window boolean;
  v_used_today int;
  v_result jsonb;
BEGIN
  v_in_window := (v_now_ist::time >= _window_start::time AND v_now_ist::time < _window_end::time);

  SELECT count(*) INTO v_used_today
  FROM public.voice_call_attempts
  WHERE provider = 'sarvam'
    AND source = 'member_retention'
    AND (started_at AT TIME ZONE 'Asia/Kolkata')::date = v_now_ist::date;

  WITH base AS (
    SELECT
      m.id,
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
          AND v.status NOT IN ('failed', 'cancelled')) AS last_call
    FROM public.members m
    JOIN public.branches b ON b.id = m.branch_id AND b.is_active = true
    LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.status = 'active'
      AND (_branch_ids IS NULL OR array_length(_branch_ids, 1) IS NULL OR m.branch_id = ANY (_branch_ids))
      AND EXISTS (
        SELECT 1 FROM public.memberships ms
        WHERE ms.member_id = m.id AND ms.status = 'active'
      )
  ), classified AS (
    SELECT
      id,
      (phone IS NULL OR phone !~ '^\+91[6-9][0-9]{9}$') AS missing_phone,
      dnd,
      paused,
      (last_seen IS NOT NULL AND last_seen > now() - make_interval(days => _min_absent_days)) AS too_recent,
      (last_call IS NOT NULL AND last_call > now() - make_interval(days => greatest(_cooldown_days, 0))) AS in_cooldown,
      (last_call IS NOT NULL AND (last_call AT TIME ZONE 'Asia/Kolkata')::date = v_now_ist::date) AS contacted_today
    FROM base
  )
  SELECT jsonb_build_object(
    'considered', count(*),
    'missing_phone', count(*) FILTER (WHERE missing_phone),
    'dnd', count(*) FILTER (WHERE NOT missing_phone AND dnd),
    'paused_handoff', count(*) FILTER (WHERE NOT missing_phone AND NOT dnd AND paused),
    'not_absent_enough', count(*) FILTER (WHERE NOT missing_phone AND NOT dnd AND NOT paused AND too_recent),
    'already_contacted_today', count(*) FILTER (WHERE NOT missing_phone AND NOT dnd AND NOT paused AND NOT too_recent AND contacted_today),
    'cooldown', count(*) FILTER (WHERE NOT missing_phone AND NOT dnd AND NOT paused AND NOT too_recent AND NOT contacted_today AND in_cooldown),
    'eligible', count(*) FILTER (WHERE NOT missing_phone AND NOT dnd AND NOT paused AND NOT too_recent AND NOT contacted_today AND NOT in_cooldown)
  ) INTO v_result
  FROM classified;

  RETURN v_result || jsonb_build_object(
    'in_calling_window', v_in_window,
    'calling_window', _window_start || '-' || _window_end || ' IST',
    'daily_cap', _daily_cap,
    'used_today', v_used_today,
    'remaining_today', greatest(_daily_cap - v_used_today, 0),
    'checked_at_ist', to_char(v_now_ist, 'YYYY-MM-DD HH24:MI')
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.voice_retention_eligibility(int, int, int, text, text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.voice_retention_eligibility(int, int, int, text, text, uuid[]) TO service_role;