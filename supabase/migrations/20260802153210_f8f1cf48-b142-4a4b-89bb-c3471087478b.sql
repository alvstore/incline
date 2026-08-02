-- Grant complimentary (free) days on an active or scheduled membership
CREATE OR REPLACE FUNCTION public.grant_membership_free_days(
  p_membership_id uuid,
  p_days integer,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  -- Preserve the plan's own end date so gifts stay visible and reversible
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

  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    v_ms.branch_id, v_uid, 'gift_days_granted', 'membership_free_days', v_id,
    jsonb_build_object('end_date', v_ms.end_date),
    jsonb_build_object('days_added', p_days, 'end_date', v_new_end, 'reason', btrim(p_reason))
  );

  PERFORM public.evaluate_member_access_state(v_ms.member_id, v_uid, 'Complimentary days granted', true);

  RETURN jsonb_build_object(
    'success', true,
    'free_day_id', v_id,
    'days_added', p_days,
    'new_end_date', v_new_end
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_membership_free_days(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_membership_free_days(uuid, integer, text) TO service_role;

-- Start a scheduled (pending) membership immediately
CREATE OR REPLACE FUNCTION public.start_membership_now(
  p_membership_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    v_shift := 0; -- never shorten cover if the start date is already in the past
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

  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_values, new_values)
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
$$;

GRANT EXECUTE ON FUNCTION public.start_membership_now(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_membership_now(uuid, text) TO service_role;