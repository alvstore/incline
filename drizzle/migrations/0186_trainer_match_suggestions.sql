CREATE INDEX IF NOT EXISTS member_attendance_member_checkin_idx ON public.member_attendance (member_id, check_in DESC);

CREATE OR REPLACE FUNCTION public.trainer_match_data(p_branch_id uuid, p_days int DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_members jsonb; v_trainers jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT (public.has_any_role(v_uid, ARRAY['owner','admin']::text[])
          OR p_branch_id IN (SELECT public.managed_branch_ids(v_uid))) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  p_days := LEAST(GREATEST(COALESCE(p_days,60),7),180);

  WITH um AS (
    SELECT m.id, m.member_code, p.full_name, p.phone,
      (SELECT mp.name FROM public.memberships ms JOIN public.membership_plans mp ON mp.id = ms.plan_id
        WHERE ms.member_id = m.id AND ms.status = 'active' ORDER BY ms.end_date DESC NULLS LAST LIMIT 1) AS plan_name
    FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.branch_id = p_branch_id AND m.assigned_trainer_id IS NULL
      AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id = m.id AND ms.status = 'active')
  ), days AS (
    SELECT a.member_id, (a.check_in AT TIME ZONE 'Asia/Kolkata')::date d,
      min(a.check_in AT TIME ZONE 'Asia/Kolkata') first_in
    FROM public.member_attendance a JOIN um ON um.id = a.member_id
    WHERE a.check_in >= now() - make_interval(days => p_days)
    GROUP BY 1,2
  ), agg AS (
    SELECT member_id, count(*)::int visits,
      array_agg((extract(hour FROM first_in)*60 + extract(minute FROM first_in))::int ORDER BY first_in) minutes,
      array_agg(extract(dow FROM d)::int) dows,
      max(d) last_visit
    FROM days GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'member_id', um.id, 'member_code', um.member_code, 'name', um.full_name, 'phone', um.phone,
    'plan_name', um.plan_name, 'visits', COALESCE(agg.visits,0),
    'minutes', COALESCE(to_jsonb(agg.minutes),'[]'::jsonb), 'dows', COALESCE(to_jsonb(agg.dows),'[]'::jsonb),
    'last_visit', agg.last_visit) ORDER BY COALESCE(agg.visits,0) DESC), '[]'::jsonb)
  INTO v_members FROM um LEFT JOIN agg ON agg.member_id = um.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'trainer_id', t.id, 'name', p.full_name, 'avatar_url', p.avatar_url,
    'max_clients', COALESCE(t.max_clients,20), 'weekly_off', t.weekly_off,
    'clients', (SELECT count(*) FROM public.members m WHERE m.assigned_trainer_id = t.id AND m.status = 'active')
             + (SELECT count(*) FROM public.member_pt_packages pp WHERE pp.trainer_id = t.id AND pp.status = 'active'),
    'shifts', COALESCE((SELECT jsonb_agg(jsonb_build_object('weekday', s.weekday, 'off', s.is_weekly_off,
        'ms', s.morning_start, 'me', s.morning_end, 'es', s.evening_start, 'ee', s.evening_end,
        'st', s.start_time, 'et', s.end_time)) FROM public.staff_shifts s WHERE s.user_id = t.user_id), '[]'::jsonb)
  )), '[]'::jsonb)
  INTO v_trainers FROM public.trainers t LEFT JOIN public.profiles p ON p.id = t.user_id
  WHERE t.branch_id = p_branch_id AND t.is_active;

  RETURN jsonb_build_object('members', v_members, 'trainers', v_trainers);
END $$;
REVOKE ALL ON FUNCTION public.trainer_match_data(uuid,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trainer_match_data(uuid,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bulk_assign_trainers(p_assignments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); r jsonb; v_branch uuid; v_tbranch uuid; v_ok int := 0; v_failed jsonb := '[]'::jsonb;
  v_admin boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF jsonb_typeof(p_assignments) <> 'array' OR jsonb_array_length(p_assignments) > 50 THEN
    RAISE EXCEPTION 'max_50_assignments';
  END IF;
  v_admin := public.has_any_role(v_uid, ARRAY['owner','admin']::text[]);
  FOR r IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
    SELECT branch_id INTO v_branch FROM public.members WHERE id = (r->>'member_id')::uuid;
    SELECT branch_id INTO v_tbranch FROM public.trainers WHERE id = (r->>'trainer_id')::uuid AND is_active;
    IF v_branch IS NULL OR v_tbranch IS NULL OR v_branch <> v_tbranch
       OR NOT (v_admin OR v_branch IN (SELECT public.managed_branch_ids(v_uid))) THEN
      v_failed := v_failed || jsonb_build_array(r->>'member_id'); CONTINUE;
    END IF;
    UPDATE public.members SET assigned_trainer_id = (r->>'trainer_id')::uuid, updated_at = now()
      WHERE id = (r->>'member_id')::uuid AND assigned_trainer_id IS NULL;
    IF FOUND THEN v_ok := v_ok + 1; ELSE v_failed := v_failed || jsonb_build_array(r->>'member_id'); END IF;
  END LOOP;
  RETURN jsonb_build_object('assigned', v_ok, 'failed', v_failed);
END $$;
REVOKE ALL ON FUNCTION public.bulk_assign_trainers(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_assign_trainers(jsonb) TO authenticated, service_role;

INSERT INTO public.settings (branch_id, key, value)
SELECT NULL, 'trainer_match_v1', '{"enabled": true}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.settings WHERE branch_id IS NULL AND key = 'trainer_match_v1');