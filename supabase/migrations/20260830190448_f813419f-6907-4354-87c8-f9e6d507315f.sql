-- Shared retention predicate: single source of truth for both the summary
-- counters and the row-returning queue. Internal only.
CREATE OR REPLACE FUNCTION public.voice_retention_candidates(
  _min_absent_days integer DEFAULT 7,
  _cooldown_days integer DEFAULT 7,
  _branch_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE (
  member_id uuid,
  branch_id uuid,
  phone text,
  last_seen timestamptz,
  last_call timestamptz,
  missing_phone boolean,
  dnd boolean,
  paused boolean,
  too_recent boolean,
  in_cooldown boolean,
  contacted_today boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
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
  )
  SELECT
    id,
    branch_id,
    phone,
    last_seen,
    last_call,
    (phone IS NULL OR phone !~ '^\+91[6-9][0-9]{9}$') AS missing_phone,
    dnd,
    paused,
    (last_seen IS NOT NULL AND last_seen > now() - make_interval(days => _min_absent_days)) AS too_recent,
    (last_call IS NOT NULL AND last_call > now() - make_interval(days => greatest(_cooldown_days, 0))) AS in_cooldown,
    (last_call IS NOT NULL
      AND (last_call AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS contacted_today
  FROM base;
$function$;

REVOKE ALL ON FUNCTION public.voice_retention_candidates(integer, integer, uuid[]) FROM PUBLIC, anon, authenticated;

-- Summary counters now derive from the shared predicate (no drift).
CREATE OR REPLACE FUNCTION public.voice_retention_eligibility(
  _min_absent_days integer DEFAULT 7,
  _cooldown_days integer DEFAULT 7,
  _daily_cap integer DEFAULT 25,
  _window_start text DEFAULT '10:00'::text,
  _window_end text DEFAULT '19:00'::text,
  _branch_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  SELECT jsonb_build_object(
    'considered', count(*),
    'missing_phone', count(*) FILTER (WHERE c.missing_phone),
    'dnd', count(*) FILTER (WHERE NOT c.missing_phone AND c.dnd),
    'paused_handoff', count(*) FILTER (WHERE NOT c.missing_phone AND NOT c.dnd AND c.paused),
    'not_absent_enough', count(*) FILTER (WHERE NOT c.missing_phone AND NOT c.dnd AND NOT c.paused AND c.too_recent),
    'already_contacted_today', count(*) FILTER (WHERE NOT c.missing_phone AND NOT c.dnd AND NOT c.paused AND NOT c.too_recent AND c.contacted_today),
    'cooldown', count(*) FILTER (WHERE NOT c.missing_phone AND NOT c.dnd AND NOT c.paused AND NOT c.too_recent AND NOT c.contacted_today AND c.in_cooldown),
    'eligible', count(*) FILTER (WHERE NOT c.missing_phone AND NOT c.dnd AND NOT c.paused AND NOT c.too_recent AND NOT c.contacted_today AND NOT c.in_cooldown)
  ) INTO v_result
  FROM public.voice_retention_candidates(_min_absent_days, _cooldown_days, _branch_ids) c;

  RETURN v_result || jsonb_build_object(
    'in_calling_window', v_in_window,
    'calling_window', _window_start || '-' || _window_end || ' IST',
    'daily_cap', _daily_cap,
    'used_today', v_used_today,
    'remaining_today', greatest(_daily_cap - v_used_today, 0),
    'checked_at_ist', to_char(v_now_ist, 'YYYY-MM-DD HH24:MI')
  );
END;
$function$;

-- Role-aware, branch-scoped, masked read of the same eligible set.
CREATE OR REPLACE FUNCTION public.voice_retention_queue(
  p_branch uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  member_id uuid,
  member_name text,
  member_code text,
  masked_phone text,
  branch_id uuid,
  branch_name text,
  last_visit timestamptz,
  days_absent integer,
  plan_name text,
  plan_expiry date,
  trainer_name text,
  last_call_at timestamptz,
  last_call_id uuid,
  last_disposition text,
  eligible_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_branches uuid[];
  v_min int;
  v_cooldown int;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT array_agg(b) INTO v_branches FROM public.user_visible_branch_ids(v_uid) b;
  IF p_branch IS NOT NULL THEN
    IF NOT (p_branch = ANY (coalesce(v_branches, ARRAY[]::uuid[]))) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
    v_branches := ARRAY[p_branch];
  END IF;

  SELECT
    coalesce((retention_automation ->> 'min_absent_days')::int, 7),
    coalesce((retention_automation ->> 'cooldown_days')::int, 7)
  INTO v_min, v_cooldown
  FROM public.voice_provider_integrations
  WHERE provider = 'sarvam'
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  RETURN QUERY
  WITH eligible AS (
    SELECT c.*
    FROM public.voice_retention_candidates(coalesce(v_min, 7), coalesce(v_cooldown, 7), v_branches) c
    WHERE NOT c.missing_phone AND NOT c.dnd AND NOT c.paused
      AND NOT c.too_recent AND NOT c.contacted_today AND NOT c.in_cooldown
  ), enriched AS (
    SELECT
      e.member_id AS mid,
      coalesce(pr.full_name, 'Unknown') AS m_name,
      m.member_code AS m_code,
      public.voice_mask_phone(e.phone) AS m_phone,
      e.branch_id AS b_id,
      br.name AS b_name,
      e.last_seen AS l_visit,
      CASE WHEN e.last_seen IS NULL THEN NULL
           ELSE (EXTRACT(day FROM (now() - e.last_seen)))::int END AS d_absent,
      (SELECT mp.name FROM public.memberships ms
        JOIN public.membership_plans mp ON mp.id = ms.plan_id
        WHERE ms.member_id = e.member_id ORDER BY ms.created_at DESC LIMIT 1) AS p_name,
      (SELECT ms.end_date FROM public.memberships ms
        WHERE ms.member_id = e.member_id ORDER BY ms.created_at DESC LIMIT 1) AS p_expiry,
      tr.full_name AS t_name,
      lc.started_at AS lc_at,
      lc.id AS lc_id,
      lc.disposition AS lc_disp,
      count(*) OVER () AS n_total
    FROM eligible e
    JOIN public.members m ON m.id = e.member_id
    LEFT JOIN public.profiles pr ON pr.id = m.user_id
    LEFT JOIN public.branches br ON br.id = e.branch_id
    LEFT JOIN public.trainers tn ON tn.id = m.assigned_trainer_id
    LEFT JOIN public.profiles tr ON tr.id = tn.user_id
    LEFT JOIN LATERAL (
      SELECT v.id, v.started_at, v.disposition
      FROM public.voice_call_attempts v
      WHERE v.member_id = e.member_id
      ORDER BY v.started_at DESC NULLS LAST
      LIMIT 1
    ) lc ON true
  )
  SELECT
    mid, m_name, m_code, m_phone, b_id, b_name, l_visit, d_absent,
    p_name, p_expiry, t_name, lc_at, lc_id, lc_disp,
    now() AS eligible_at,
    n_total
  FROM enriched
  ORDER BY l_visit ASC NULLS FIRST, m_name ASC
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

REVOKE ALL ON FUNCTION public.voice_retention_queue(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voice_retention_queue(uuid, integer, integer) TO authenticated;