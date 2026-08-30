-- Voice AI operations: sanitized, role-aware read RPCs (no new tables)

CREATE OR REPLACE FUNCTION public.voice_mask_phone(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _phone IS NULL OR length(_phone) < 4 THEN NULL
    ELSE repeat('•', greatest(length(_phone) - 4, 0)) || right(_phone, 4)
  END;
$$;

CREATE OR REPLACE FUNCTION public.voice_calls_feed(
  p_branch uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_disposition text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  member_id uuid,
  lead_id uuid,
  member_name text,
  member_code text,
  masked_phone text,
  branch_id uuid,
  branch_name text,
  last_visit timestamptz,
  days_absent_at_call integer,
  call_started_at timestamptz,
  call_ended_at timestamptz,
  duration_seconds numeric,
  status text,
  disposition text,
  reason_for_absence text,
  next_step_agreed text,
  call_summary text,
  callback_datetime text,
  action_state text,
  provider_attempt_id text,
  interaction_id text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_branches uuid[];
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff']::app_role[]) THEN
    RETURN;
  END IF;

  SELECT array_agg(b) INTO v_branches FROM public.user_visible_branch_ids(v_uid) b;
  IF v_branches IS NULL THEN
    RETURN;
  END IF;

  -- A branch filter can only ever narrow the authorized scope.
  IF p_branch IS NOT NULL THEN
    IF NOT (p_branch = ANY (v_branches)) THEN
      RETURN;
    END IF;
    v_branches := ARRAY[p_branch];
  END IF;

  RETURN QUERY
  WITH scoped AS (
    SELECT v.*
    FROM public.voice_call_attempts v
    WHERE v.branch_id = ANY (v_branches)
      AND (p_from IS NULL OR coalesce(v.started_at, v.created_at) >= p_from)
      AND (p_to IS NULL OR coalesce(v.started_at, v.created_at) < p_to)
      AND (p_status IS NULL OR v.status = p_status)
      AND (p_disposition IS NULL OR v.disposition = p_disposition)
  ), joined AS (
    SELECT
      s.id,
      s.created_at,
      s.member_id,
      s.lead_id,
      coalesce(pr.full_name, l.full_name) AS member_name,
      m.member_code,
      s.phone,
      s.branch_id,
      br.name AS branch_name,
      (SELECT max(a.check_in) FROM public.member_attendance a
        WHERE a.member_id = s.member_id
          AND a.check_in < coalesce(s.started_at, s.created_at)) AS last_visit,
      s.started_at,
      s.ended_at,
      s.duration_seconds,
      s.status,
      s.disposition,
      nullif(s.context_payload #>> '{final_agent_variables,reason_for_absence}', '') AS reason_for_absence,
      nullif(s.context_payload #>> '{final_agent_variables,next_step_agreed}', '') AS next_step_agreed,
      nullif(s.context_payload #>> '{final_agent_variables,call_summary}', '') AS call_summary,
      nullif(s.context_payload #>> '{final_agent_variables,callback_datetime}', '') AS callback_datetime,
      s.provider_call_id,
      s.provider_interaction_id
    FROM scoped s
    LEFT JOIN public.members m ON m.id = s.member_id
    LEFT JOIN public.profiles pr ON pr.id = m.user_id
    LEFT JOIN public.leads l ON l.id = s.lead_id
    LEFT JOIN public.branches br ON br.id = s.branch_id
  ), filtered AS (
    SELECT j.* FROM joined j
    WHERE v_search IS NULL
       OR j.member_name ILIKE '%' || v_search || '%'
       OR j.member_code ILIKE '%' || v_search || '%'
       OR j.phone ILIKE '%' || regexp_replace(v_search, '[^0-9+]', '', 'g') || '%'
  ), counted AS (
    SELECT f.*, count(*) OVER () AS total_count FROM filtered f
  )
  SELECT
    c.id,
    c.created_at,
    c.member_id,
    c.lead_id,
    c.member_name,
    c.member_code,
    public.voice_mask_phone(c.phone),
    c.branch_id,
    c.branch_name,
    c.last_visit,
    CASE WHEN c.last_visit IS NULL THEN NULL
         ELSE greatest(0, (coalesce(c.started_at, c.created_at)::date - c.last_visit::date))::int END,
    c.started_at,
    c.ended_at,
    c.duration_seconds,
    c.status,
    c.disposition,
    c.reason_for_absence,
    c.next_step_agreed,
    c.call_summary,
    c.callback_datetime,
    (
      SELECT CASE t.status::text
               WHEN 'completed' THEN 'completed'
               WHEN 'cancelled' THEN 'completed'
               WHEN 'in_progress' THEN 'in_progress'
               ELSE 'open'
             END
      FROM public.tasks t
      WHERE t.linked_entity_id = coalesce(c.member_id, c.lead_id)
        AND t.title ILIKE 'Voice AI:%'
        AND t.created_at >= coalesce(c.started_at, c.created_at) - interval '5 minutes'
      ORDER BY t.created_at ASC
      LIMIT 1
    ),
    c.provider_call_id,
    c.provider_interaction_id,
    c.total_count
  FROM counted c
  ORDER BY coalesce(c.started_at, c.created_at) DESC, c.id DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_call_detail(p_call_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_can_transcript boolean;
  v_row record;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT
    v.id, v.branch_id, v.member_id, v.lead_id, v.phone, v.status, v.disposition,
    v.started_at, v.ended_at, v.duration_seconds, v.reason, v.eligible_at,
    v.provider_call_id, v.provider_interaction_id, v.agent_id, v.agent_version,
    v.error_message, v.context_payload,
    br.name AS branch_name,
    m.member_code, m.status::text AS member_status,
    coalesce(pr.full_name, l.full_name) AS member_name,
    tr.full_name AS trainer_name
  INTO v_row
  FROM public.voice_call_attempts v
  LEFT JOIN public.branches br ON br.id = v.branch_id
  LEFT JOIN public.members m ON m.id = v.member_id
  LEFT JOIN public.profiles pr ON pr.id = m.user_id
  LEFT JOIN public.leads l ON l.id = v.lead_id
  LEFT JOIN public.trainers tn ON tn.id = m.assigned_trainer_id
  LEFT JOIN public.profiles tr ON tr.id = tn.user_id
  WHERE v.id = p_call_id
    AND v.branch_id IN (SELECT public.user_visible_branch_ids(v_uid));

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  v_can_transcript := public.has_any_role(v_uid, ARRAY['owner','admin','manager']::app_role[]);

  v_result := jsonb_build_object(
    'id', v_row.id,
    'member_id', v_row.member_id,
    'lead_id', v_row.lead_id,
    'member_name', v_row.member_name,
    'member_code', v_row.member_code,
    'member_status', v_row.member_status,
    'masked_phone', public.voice_mask_phone(v_row.phone),
    'branch_id', v_row.branch_id,
    'branch_name', v_row.branch_name,
    'trainer_name', v_row.trainer_name,
    'plan_name', (
      SELECT mp.name FROM public.memberships ms
      JOIN public.membership_plans mp ON mp.id = ms.plan_id
      WHERE ms.member_id = v_row.member_id
      ORDER BY ms.created_at DESC LIMIT 1
    ),
    'plan_expiry', (
      SELECT ms.end_date FROM public.memberships ms
      WHERE ms.member_id = v_row.member_id
      ORDER BY ms.created_at DESC LIMIT 1
    ),
    'reason', v_row.reason,
    'eligible_at', v_row.eligible_at,
    'last_visit', (
      SELECT max(a.check_in) FROM public.member_attendance a
      WHERE a.member_id = v_row.member_id
        AND a.check_in < coalesce(v_row.started_at, now())
    ),
    'started_at', v_row.started_at,
    'ended_at', v_row.ended_at,
    'duration_seconds', v_row.duration_seconds,
    'status', v_row.status,
    'agent_id', v_row.agent_id,
    'agent_version', v_row.agent_version,
    'provider_attempt_id', v_row.provider_call_id,
    'interaction_id', v_row.provider_interaction_id,
    'error_message', v_row.error_message,
    'disposition', v_row.disposition,
    'reason_for_absence', nullif(v_row.context_payload #>> '{final_agent_variables,reason_for_absence}', ''),
    'next_step_agreed', nullif(v_row.context_payload #>> '{final_agent_variables,next_step_agreed}', ''),
    'call_summary', nullif(v_row.context_payload #>> '{final_agent_variables,call_summary}', ''),
    'callback_datetime', nullif(v_row.context_payload #>> '{final_agent_variables,callback_datetime}', ''),
    'can_view_transcript', v_can_transcript,
    'transcript', CASE WHEN v_can_transcript THEN v_row.context_payload -> 'transcript' ELSE NULL END,
    'tasks', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'status', t.status::text,
               'priority', t.priority::text, 'due_date', t.due_date,
               'assigned_to', t.assigned_to
             ) ORDER BY t.created_at)
      FROM public.tasks t
      WHERE t.linked_entity_id = coalesce(v_row.member_id, v_row.lead_id)
        AND t.title ILIKE 'Voice AI:%'
        AND t.created_at >= coalesce(v_row.started_at, v_row.ended_at, now()) - interval '5 minutes'
    ), '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.voice_calls_analytics(
  p_branch uuid DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_branches uuid[];
  v_days int := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from timestamptz;
  v_result jsonb;
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

  v_from := now() - make_interval(days => v_days);

  WITH scoped AS (
    SELECT v.* FROM public.voice_call_attempts v
    WHERE v.branch_id = ANY (v_branches)
      AND coalesce(v.started_at, v.created_at) >= v_from
  )
  SELECT jsonb_build_object(
    'window_days', v_days,
    'attempted', count(*),
    'connected', count(*) FILTER (WHERE s.status IN ('answered','in_progress','completed')),
    'completed', count(*) FILTER (WHERE s.status = 'completed'),
    'no_answer', count(*) FILTER (WHERE s.status = 'no_answer'),
    'failed', count(*) FILTER (WHERE s.status IN ('failed','busy','cancelled')),
    'coming_back', count(*) FILTER (WHERE s.disposition = 'coming_back'),
    'callback_requested', count(*) FILTER (WHERE s.disposition = 'callback_requested'),
    'complaint', count(*) FILTER (WHERE s.disposition = 'complaint'),
    'not_interested', count(*) FILTER (WHERE s.disposition = 'not_interested'),
    'wrong_person', count(*) FILTER (WHERE s.disposition = 'wrong_person'),
    'needs_human', count(*) FILTER (WHERE s.disposition = 'needs_human'),
    'no_clear_outcome', count(*) FILTER (WHERE s.disposition = 'no_clear_outcome'),
    'contacted_members', count(DISTINCT s.member_id) FILTER (
      WHERE s.member_id IS NOT NULL AND s.status IN ('answered','in_progress','completed')),
    'returned_within_7', count(DISTINCT s.member_id) FILTER (
      WHERE s.member_id IS NOT NULL AND s.status IN ('answered','in_progress','completed')
        AND EXISTS (
          SELECT 1 FROM public.member_attendance a
          WHERE a.member_id = s.member_id
            AND a.check_in > coalesce(s.started_at, s.created_at)
            AND a.check_in <= coalesce(s.started_at, s.created_at) + interval '7 days')),
    'returned_within_14', count(DISTINCT s.member_id) FILTER (
      WHERE s.member_id IS NOT NULL AND s.status IN ('answered','in_progress','completed')
        AND EXISTS (
          SELECT 1 FROM public.member_attendance a
          WHERE a.member_id = s.member_id
            AND a.check_in > coalesce(s.started_at, s.created_at)
            AND a.check_in <= coalesce(s.started_at, s.created_at) + interval '14 days'))
  ) INTO v_result
  FROM scoped s;

  RETURN coalesce(v_result, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.voice_calls_feed(uuid, timestamptz, timestamptz, text, text, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.voice_call_detail(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.voice_calls_analytics(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.voice_mask_phone(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.voice_calls_feed(uuid, timestamptz, timestamptz, text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_call_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_calls_analytics(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_mask_phone(text) TO authenticated;