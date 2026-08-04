-- 1. Fix audit column names in grant_membership_free_days
CREATE OR REPLACE FUNCTION public.grant_membership_free_days(p_membership_id uuid, p_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ms public.memberships%ROWTYPE;
  v_new_end date;
  v_id uuid;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days <= 0 THEN
    RAISE EXCEPTION 'INVALID_DAYS: must be greater than zero' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' OR length(btrim(p_reason)) < 6 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: minimum 6 characters' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ms FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_ms.status NOT IN ('active'::public.membership_status,
                         'pending'::public.membership_status,
                         'frozen'::public.membership_status) THEN
    RAISE EXCEPTION 'INVALID_STATUS: cannot gift days on a % membership', v_ms.status USING ERRCODE = 'P0001';
  END IF;

  IF v_ms.original_end_date IS NULL THEN
    UPDATE public.memberships SET original_end_date = v_ms.end_date WHERE id = v_ms.id;
  END IF;

  v_new_end := v_ms.end_date + p_days;

  INSERT INTO public.membership_free_days (membership_id, days_added, reason, added_by)
  VALUES (p_membership_id, p_days, btrim(p_reason), v_uid)
  RETURNING id INTO v_id;

  UPDATE public.memberships
     SET end_date = v_new_end, updated_at = now()
   WHERE id = p_membership_id;

  BEGIN
    INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      v_ms.branch_id, v_uid, 'gift_days_granted', 'membership_free_days', v_id,
      jsonb_build_object('end_date', v_ms.end_date),
      jsonb_build_object('days_added', p_days, 'end_date', v_new_end, 'reason', btrim(p_reason))
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM public.evaluate_member_access_state(v_ms.member_id, v_uid, 'Complimentary days granted', true);

  RETURN jsonb_build_object(
    'success', true,
    'free_day_id', v_id,
    'days_added', p_days,
    'new_end_date', v_new_end
  );
END;
$function$;

-- 2. Helper: map a benefit_types.code to the benefit_type enum, falling back to 'other'
CREATE OR REPLACE FUNCTION public.safe_benefit_enum(p_code text)
RETURNS public.benefit_type
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN p_code::public.benefit_type;
EXCEPTION WHEN OTHERS THEN
  RETURN 'other'::public.benefit_type;
END;
$function$;

-- 3. Comp grants also mirror into member_benefit_credits so the portal + booking engine see them
CREATE OR REPLACE FUNCTION public.grant_member_comp(p_member_id uuid, p_benefit_type_id uuid, p_sessions integer, p_reason text, p_notes text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT 'direct'::text, p_approval_request_id uuid DEFAULT NULL::uuid, p_membership_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_granted_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid := p_branch_id;
  v_actor  uuid := COALESCE(p_granted_by, auth.uid());
  v_new_id uuid;
  v_bt_name text;
  v_bt_code text;
  v_member_name text;
  v_membership_id uuid := p_membership_id;
  v_expires timestamptz;
  v_credit_id uuid;
BEGIN
  IF p_sessions IS NULL OR p_sessions <= 0 THEN
    RAISE EXCEPTION 'sessions must be positive';
  END IF;
  IF p_source NOT IN ('direct','approval') THEN
    RAISE EXCEPTION 'source must be direct or approval';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role]) THEN
    RAISE EXCEPTION 'Not authorized to grant comps';
  END IF;

  IF v_branch IS NULL THEN
    SELECT branch_id INTO v_branch FROM public.members WHERE id = p_member_id;
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Could not resolve branch for member %', p_member_id;
  END IF;

  INSERT INTO public.member_comps
    (member_id, membership_id, benefit_type_id, comp_sessions, used_sessions,
     reason, notes, expires_at, source, approval_request_id, branch_id, granted_by)
  VALUES
    (p_member_id, p_membership_id, p_benefit_type_id, p_sessions, 0,
     COALESCE(p_reason,'Complimentary'), p_notes, p_expires_at,
     p_source, p_approval_request_id, v_branch, v_actor)
  RETURNING id INTO v_new_id;

  SELECT name, code INTO v_bt_name, v_bt_code FROM public.benefit_types WHERE id = p_benefit_type_id;

  -- Resolve the membership + expiry for the mirrored credit row
  IF v_membership_id IS NULL THEN
    SELECT id INTO v_membership_id
      FROM public.memberships
     WHERE member_id = p_member_id
       AND status IN ('active'::public.membership_status,'pending'::public.membership_status,'frozen'::public.membership_status)
     ORDER BY end_date DESC
     LIMIT 1;
  END IF;

  v_expires := p_expires_at;
  IF v_expires IS NULL AND v_membership_id IS NOT NULL THEN
    SELECT (end_date + 1)::timestamptz INTO v_expires FROM public.memberships WHERE id = v_membership_id;
  END IF;
  IF v_expires IS NULL THEN
    v_expires := now() + interval '1 year';
  END IF;

  INSERT INTO public.member_benefit_credits
    (member_id, membership_id, benefit_type, benefit_type_id, credits_total, credits_remaining, purchased_at, expires_at)
  VALUES
    (p_member_id, v_membership_id, public.safe_benefit_enum(v_bt_code), p_benefit_type_id,
     p_sessions, p_sessions, now(), v_expires)
  RETURNING id INTO v_credit_id;

  SELECT COALESCE(p.full_name, m.member_code)
    INTO v_member_name
    FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.id = p_member_id;

  RETURN jsonb_build_object(
    'success', true,
    'comp_id', v_new_id,
    'credit_id', v_credit_id,
    'branch_id', v_branch,
    'member_name', v_member_name,
    'benefit_name', v_bt_name
  );
END;
$function$;

-- 4. Amend / revoke a complimentary gift
CREATE OR REPLACE FUNCTION public.amend_member_comp(p_comp_id uuid, p_new_sessions integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_comp public.member_comps%ROWTYPE;
  v_bt_code text;
  v_delta int;
  v_credit RECORD;
  v_remaining_to_apply int;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' OR length(btrim(p_reason)) < 4 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: minimum 4 characters' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_sessions IS NULL OR p_new_sessions < 0 THEN
    RAISE EXCEPTION 'INVALID_SESSIONS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_comp FROM public.member_comps WHERE id = p_comp_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMP_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF p_new_sessions < COALESCE(v_comp.used_sessions,0) THEN
    RAISE EXCEPTION 'ALREADY_USED: % session(s) already consumed on this gift', v_comp.used_sessions USING ERRCODE = 'P0001';
  END IF;

  v_delta := p_new_sessions - v_comp.comp_sessions;

  SELECT code INTO v_bt_code FROM public.benefit_types WHERE id = v_comp.benefit_type_id;

  -- Keep mirrored credits in step (oldest first)
  IF v_delta < 0 THEN
    v_remaining_to_apply := -v_delta;
    FOR v_credit IN
      SELECT * FROM public.member_benefit_credits
       WHERE member_id = v_comp.member_id
         AND benefit_type_id = v_comp.benefit_type_id
         AND credits_remaining > 0
       ORDER BY created_at ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining_to_apply <= 0;
      IF v_credit.credits_remaining <= v_remaining_to_apply THEN
        v_remaining_to_apply := v_remaining_to_apply - v_credit.credits_remaining;
        UPDATE public.member_benefit_credits
           SET credits_total = GREATEST(0, credits_total - v_credit.credits_remaining),
               credits_remaining = 0,
               updated_at = now()
         WHERE id = v_credit.id;
      ELSE
        UPDATE public.member_benefit_credits
           SET credits_total = GREATEST(0, credits_total - v_remaining_to_apply),
               credits_remaining = credits_remaining - v_remaining_to_apply,
               updated_at = now()
         WHERE id = v_credit.id;
        v_remaining_to_apply := 0;
      END IF;
    END LOOP;
  ELSIF v_delta > 0 THEN
    SELECT * INTO v_credit FROM public.member_benefit_credits
      WHERE member_id = v_comp.member_id
        AND benefit_type_id = v_comp.benefit_type_id
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE public.member_benefit_credits
         SET credits_total = credits_total + v_delta,
             credits_remaining = credits_remaining + v_delta,
             updated_at = now()
       WHERE id = v_credit.id;
    ELSE
      INSERT INTO public.member_benefit_credits
        (member_id, membership_id, benefit_type, benefit_type_id, credits_total, credits_remaining, purchased_at, expires_at)
      VALUES
        (v_comp.member_id, v_comp.membership_id, public.safe_benefit_enum(v_bt_code), v_comp.benefit_type_id,
         v_delta, v_delta, now(), COALESCE(v_comp.expires_at, now() + interval '1 year'));
    END IF;
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
    VALUES (
      v_comp.branch_id, v_uid,
      CASE WHEN p_new_sessions = 0 THEN 'comp_revoked' ELSE 'comp_amended' END,
      'member_comps', p_comp_id,
      jsonb_build_object('comp_sessions', v_comp.comp_sessions, 'used_sessions', v_comp.used_sessions),
      jsonb_build_object('comp_sessions', p_new_sessions, 'reason', btrim(p_reason))
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'comp_id', p_comp_id, 'comp_sessions', p_new_sessions, 'revoked', p_new_sessions = 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.amend_member_comp(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_benefit_enum(text) TO authenticated, service_role;