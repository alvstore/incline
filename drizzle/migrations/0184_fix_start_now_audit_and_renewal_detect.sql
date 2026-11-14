CREATE OR REPLACE FUNCTION public.start_membership_now(p_membership_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ms public.memberships%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_shift integer;
  v_new_end date;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ms FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_ms.status <> 'pending'::public.membership_status THEN
    RAISE EXCEPTION 'INVALID_STATUS: only scheduled memberships can be started early' USING ERRCODE = 'P0001';
  END IF;

  v_shift := v_today - v_ms.start_date;
  IF v_shift > 0 THEN
    v_shift := 0;
  END IF;
  v_new_end := v_ms.end_date + v_shift;

  UPDATE public.memberships
     SET status = 'active'::public.membership_status,
         start_date = LEAST(v_ms.start_date, v_today),
         end_date = v_new_end,
         original_end_date = CASE
           WHEN v_ms.original_end_date IS NOT NULL THEN v_ms.original_end_date + v_shift
           ELSE NULL
         END,
         updated_at = now()
   WHERE id = p_membership_id;

  UPDATE public.members
     SET lifecycle_state = 'active', updated_at = now()
   WHERE id = v_ms.member_id
     AND lifecycle_state IN ('pending_plan', 'pending');

  UPDATE public.locker_assignments la
     SET is_active = true
   WHERE la.member_id = v_ms.member_id
     AND la.start_date = v_ms.start_date
     AND la.is_active = false;

  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    v_ms.branch_id, v_uid, 'membership_started_early', 'memberships', p_membership_id,
    jsonb_build_object('status', v_ms.status, 'start_date', v_ms.start_date, 'end_date', v_ms.end_date),
    jsonb_build_object('status', 'active', 'start_date', LEAST(v_ms.start_date, v_today),
                       'end_date', v_new_end, 'reason', btrim(COALESCE(p_reason, 'Started early')))
  );

  PERFORM public.evaluate_member_access_state(v_ms.member_id, v_uid, 'Membership started early', true);

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', p_membership_id,
    'start_date', LEAST(v_ms.start_date, v_today),
    'end_date', v_new_end,
    'days_shifted', v_shift
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.detect_renewal_cases(_lookahead_days integer DEFAULT 21)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
        v_opened integer := 0; v_refreshed integer := 0; v_closed integer := 0; v_corrected integer := 0;
        v_case record; v_succ record; v_evidence text;
BEGIN
  WITH candidates AS (
    SELECT DISTINCT ON (m.member_id) m.id AS membership_id, m.member_id, m.branch_id, m.plan_id, m.end_date
    FROM public.memberships m JOIN public.members mem ON mem.id = m.member_id
    WHERE m.status IN ('active','expired','frozen')
      AND m.end_date BETWEEN v_today - 30 AND v_today + _lookahead_days
      AND mem.status <> 'blacklisted'
      AND NOT EXISTS (SELECT 1 FROM public.memberships s WHERE s.member_id = m.member_id
                      AND s.id <> m.id AND s.status IN ('active','frozen') AND s.end_date > m.end_date + _lookahead_days)
    ORDER BY m.member_id, m.end_date DESC, m.created_at DESC
  ), upserted AS (
    INSERT INTO public.renewal_cases (branch_id, member_id, membership_id, plan_id, expiry_date, stage)
    SELECT c.branch_id, c.member_id, c.membership_id, c.plan_id, c.end_date, 'eligible' FROM candidates c
    ON CONFLICT (membership_id) DO UPDATE
      SET expiry_date = EXCLUDED.expiry_date, plan_id = EXCLUDED.plan_id, updated_at = now()
      WHERE public.renewal_cases.closed_at IS NULL
    RETURNING (xmax = 0) AS inserted
  )
  SELECT count(*) FILTER (WHERE inserted), count(*) FILTER (WHERE NOT inserted) INTO v_opened, v_refreshed FROM upserted;

  FOR v_case IN
    SELECT * FROM public.renewal_cases
    WHERE closed_at IS NULL
       OR (stage IN ('churned','win_back','not_interested','lapsed') AND closed_at > now() - interval '120 days')
  LOOP
    v_succ := NULL;
    SELECT m.* INTO v_succ FROM public.memberships m
    WHERE m.member_id = v_case.member_id AND m.id <> v_case.membership_id
      AND m.status IN ('active','frozen','expired') AND m.end_date > v_case.expiry_date
      AND (v_case.closed_at IS NULL OR m.status <> 'expired' OR true)
    ORDER BY m.end_date DESC LIMIT 1;
    IF v_succ.id IS NULL THEN CONTINUE; END IF;
    IF v_case.closed_at IS NULL AND v_succ.status = 'expired' THEN CONTINUE; END IF;
    v_evidence := public.renewal_payment_evidence(v_succ.id);
    IF v_evidence IS NOT NULL THEN
      UPDATE public.renewal_cases
         SET stage = 'renewed',
             outcome = CASE WHEN v_evidence = 'complimentary' THEN 'renewed_complimentary' ELSE 'renewed' END,
             renewal_evidence = v_evidence, renewed_membership_id = v_succ.id, candidate_membership_id = v_succ.id,
             next_action_at = NULL, closed_at = COALESCE(closed_at, now()), updated_at = now()
       WHERE id = v_case.id;
      IF v_case.closed_at IS NULL THEN
        PERFORM public.log_renewal_case_event(v_case.id, 'renewal_confirmed', 'renewed', NULL,
          'Renewal confirmed by ' || v_evidence, jsonb_build_object('membership_id', v_succ.id, 'evidence', v_evidence));
        v_closed := v_closed + 1;
      ELSE
        PERFORM public.log_renewal_case_event(v_case.id, 'stage_corrected', 'renewed', NULL,
          'Corrected by audit: paid follow-on membership found (was ' || v_case.stage || ')',
          jsonb_build_object('membership_id', v_succ.id, 'evidence', v_evidence, 'previous_stage', v_case.stage));
        v_corrected := v_corrected + 1;
      END IF;
    ELSIF v_case.closed_at IS NULL AND v_case.candidate_membership_id IS DISTINCT FROM v_succ.id THEN
      UPDATE public.renewal_cases SET candidate_membership_id = v_succ.id, updated_at = now() WHERE id = v_case.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'opened', COALESCE(v_opened,0), 'refreshed', COALESCE(v_refreshed,0),
    'closed_renewed', v_closed, 'corrected', v_corrected, 'as_of', v_today,
    'engine_enabled', COALESCE((SELECT value::text = 'true' FROM public.settings WHERE branch_id IS NULL AND key = 'renewal_engine_enabled'), false));
END; $function$;