CREATE OR REPLACE FUNCTION public.amend_member_comp(p_comp_id uuid, p_new_sessions integer, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_comp public.member_comps%ROWTYPE;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' OR length(btrim(p_reason)) < 4 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: minimum 4 characters' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_sessions IS NULL OR p_new_sessions < 0 THEN RAISE EXCEPTION 'INVALID_SESSIONS' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_comp FROM public.member_comps WHERE id = p_comp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMP_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF public.rpc_guard_applies('amend_member_comp')
     AND NOT public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role])
     AND (v_comp.branch_id IS NULL OR v_comp.branch_id NOT IN (SELECT public.user_visible_branch_ids(v_uid))) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: gift belongs to another branch' USING ERRCODE = '42501';
  END IF;
  IF p_new_sessions < COALESCE(v_comp.used_sessions,0) THEN
    RAISE EXCEPTION 'ALREADY_USED: % session(s) already consumed on this gift', v_comp.used_sessions USING ERRCODE = 'P0001';
  END IF;

  IF p_new_sessions = 0 THEN
    DELETE FROM public.member_comps WHERE id = p_comp_id;
  ELSE
    UPDATE public.member_comps
       SET comp_sessions = p_new_sessions,
           notes = COALESCE(notes,'') || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END
                   || 'Amended to ' || p_new_sessions || ': ' || btrim(p_reason),
           updated_at = now()
     WHERE id = p_comp_id;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_comp.branch_id, v_uid,
      CASE WHEN p_new_sessions = 0 THEN 'comp_revoked' ELSE 'comp_amended' END,
      'member_comps', p_comp_id,
      jsonb_build_object('comp_sessions', v_comp.comp_sessions, 'used_sessions', v_comp.used_sessions),
      jsonb_build_object('comp_sessions', p_new_sessions, 'reason', btrim(p_reason)));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'comp_id', p_comp_id, 'comp_sessions', p_new_sessions, 'revoked', p_new_sessions = 0);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_advance_recovery(_user_id uuid, _amount numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining numeric := COALESCE(_amount, 0);
  v_rec record;
  v_take numeric;
  v_global boolean := has_role(auth.uid(),'owner') OR has_role(auth.uid(),'admin');
  v_guard boolean := public.rpc_guard_applies('apply_advance_recovery');
BEGIN
  IF v_guard AND NOT (v_global OR has_role(auth.uid(),'manager')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised');
  END IF;
  IF v_guard AND NOT v_global AND EXISTS (
       SELECT 1 FROM public.salary_advances sa
        WHERE sa.user_id = _user_id AND sa.status = 'outstanding'
          AND (sa.branch_id IS NULL OR sa.branch_id NOT IN (SELECT public.user_visible_branch_ids(auth.uid())))) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorised for this employee''s branch');
  END IF;
  FOR v_rec IN
    SELECT id, outstanding FROM public.salary_advances
    WHERE user_id = _user_id AND status = 'outstanding'
    ORDER BY paid_on ASC FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_rec.outstanding, v_remaining);
    UPDATE public.salary_advances
      SET outstanding = outstanding - v_take,
          status = CASE WHEN outstanding - v_take <= 0 THEN 'recovered' ELSE 'outstanding' END
      WHERE id = v_rec.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'applied', COALESCE(_amount,0) - v_remaining);
END; $function$;

CREATE OR REPLACE FUNCTION public.analytics_session_duration_daily(p_branch uuid DEFAULT NULL::uuid, p_days integer DEFAULT 14)
 RETURNS TABLE(day date, avg_minutes numeric, member_days integer, sessions_total integer, sessions_auto integer)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT member_id,
      (check_in AT TIME ZONE 'Asia/Kolkata')::date AS day,
      EXTRACT(EPOCH FROM (check_out - check_in))/60 AS minutes,
      check_out_method
    FROM public.member_attendance
    WHERE check_in >= now() - make_interval(days => p_days)
      AND check_out IS NOT NULL
      AND (p_branch IS NULL OR branch_id = p_branch)
      AND (has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[])
           OR (has_any_role(auth.uid(), ARRAY['manager','staff']::app_role[])
               AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
           OR member_id = get_member_id(auth.uid()))
  ),
  capped AS (
    SELECT member_id, day, LEAST(GREATEST(minutes,0), 240) AS minutes, check_out_method
    FROM base WHERE minutes > 0
  ),
  per_member_day AS (
    SELECT day, member_id,
           SUM(minutes) FILTER (WHERE check_out_method <> 'auto') AS manual_minutes,
           COUNT(*) AS sessions,
           COUNT(*) FILTER (WHERE check_out_method = 'auto') AS auto_sessions
    FROM capped GROUP BY day, member_id
  )
  SELECT day,
    ROUND(AVG(manual_minutes) FILTER (WHERE manual_minutes IS NOT NULL AND manual_minutes > 0)::numeric, 1),
    COUNT(*) FILTER (WHERE manual_minutes IS NOT NULL AND manual_minutes > 0)::int,
    COALESCE(SUM(sessions),0)::int,
    COALESCE(SUM(auto_sessions),0)::int
  FROM per_member_day GROUP BY day ORDER BY day;
$function$;

CREATE OR REPLACE FUNCTION public.approve_locker_request(p_request_id uuid, p_locker_id uuid, p_size text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_req record; v_locker record; v_cfg record;
  v_fee numeric; v_rate numeric; v_end date; v_res jsonb; v_member_branch uuid;
BEGIN
  SELECT * INTO v_req FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.approval_type <> 'locker_request' THEN RAISE EXCEPTION 'Locker request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been decided'; END IF;
  SELECT * INTO v_locker FROM public.lockers WHERE id = p_locker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Locker not found'; END IF;
  SELECT branch_id INTO v_member_branch FROM public.members WHERE id = v_req.reference_id;

  -- The request, the member and the locker must all belong to the same branch.
  IF COALESCE(v_req.branch_id, v_member_branch) IS DISTINCT FROM v_locker.branch_id THEN
    RAISE EXCEPTION 'Locker and request belong to different branches' USING ERRCODE = '42501';
  END IF;

  IF public.rpc_guard_applies('approve_locker_request') THEN
    IF NOT (public.has_any_role(v_uid, ARRAY['owner','admin']::text[])
            OR (public.has_any_role(v_uid, ARRAY['manager','staff']::text[])
                AND v_locker.branch_id IN (SELECT public.user_visible_branches(v_uid)))) THEN
      RAISE EXCEPTION 'Not authorized to approve locker requests' USING ERRCODE = '42501';
    END IF;
    IF v_req.requested_by = v_uid AND NOT public.has_any_role(v_uid, ARRAY['owner','admin']::text[]) THEN
      RAISE EXCEPTION 'You cannot approve your own request' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_cfg FROM public.locker_pricing_settings WHERE branch_id = v_locker.branch_id;
  v_fee := CASE WHEN lower(p_size) = 'large' THEN COALESCE(v_cfg.large_fee, 3500) ELSE COALESCE(v_cfg.medium_fee, 2500) END;
  v_rate := CASE WHEN COALESCE(v_cfg.gst_enabled, true) THEN COALESCE(v_cfg.gst_rate, 18) ELSE 0 END;

  SELECT m.end_date INTO v_end FROM public.memberships m
   WHERE m.member_id = v_req.reference_id AND m.status IN ('active','frozen') AND m.end_date >= current_date
   ORDER BY m.end_date DESC LIMIT 1;
  IF v_end IS NULL THEN RAISE EXCEPTION 'Member has no active membership to attach a locker to'; END IF;

  v_res := public.assign_locker_with_billing(p_locker_id, v_req.reference_id, current_date, v_end,
             v_fee, 1, v_fee > 0, v_rate, v_uid, 'addon');

  UPDATE public.approval_requests SET status = 'approved', reviewed_by = v_uid, reviewed_at = now(),
    review_notes = COALESCE(NULLIF(trim(p_notes),''), 'Locker ' || v_locker.locker_number || ' assigned until ' || to_char(v_end,'DD Mon YYYY')),
    request_data = COALESCE(request_data,'{}'::jsonb) || jsonb_build_object('assigned_locker', v_locker.locker_number,
      'charged_fee', v_fee, 'gst_rate', v_rate, 'invoice_id', v_res->>'invoice_id', 'final_size', p_size),
    side_effects_committed_at = now(), updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, new_data, action_description)
  VALUES (v_locker.branch_id, v_uid, 'APPROVE', 'approval_requests', p_request_id,
    v_res || jsonb_build_object('fee', v_fee, 'gst_rate', v_rate, 'size', p_size), 'Locker request approved and invoiced');
  RETURN v_res || jsonb_build_object('fee', v_fee, 'gst_rate', v_rate, 'locker_number', v_locker.locker_number);
END $function$;