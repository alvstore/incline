CREATE OR REPLACE FUNCTION public.adjust_membership_dates(
  p_membership_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_m record;
  v_uid uuid := auth.uid();
  v_base_end date;
  v_extra int;
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' OR length(btrim(p_reason)) < 6 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: minimum 6 characters' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'INVALID_DATES' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_m FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  -- Baseline end date implied by the plan, ignoring any complimentary extensions
  v_base_end := COALESCE(v_m.original_end_date, v_m.end_date);
  IF p_start_date <> v_m.start_date THEN
    v_base_end := v_base_end + (p_start_date - v_m.start_date);
  END IF;

  UPDATE public.memberships
     SET start_date = p_start_date,
         end_date = p_end_date,
         original_end_date = v_base_end,
         updated_at = now()
   WHERE id = p_membership_id;

  -- Reconcile the complimentary-days ledger with the new end date
  v_extra := (p_end_date - v_base_end)
             - COALESCE((SELECT SUM(days_added) FROM public.membership_free_days WHERE membership_id = p_membership_id), 0);

  IF v_extra <> 0 THEN
    INSERT INTO public.membership_free_days (membership_id, days_added, reason, added_by)
    VALUES (p_membership_id, v_extra, btrim(p_reason), v_uid);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', p_membership_id,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'baseline_end_date', v_base_end,
    'ledger_delta', v_extra
  );
END; $function$;

REVOKE ALL ON FUNCTION public.adjust_membership_dates(uuid, date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_membership_dates(uuid, date, date, text) TO authenticated;