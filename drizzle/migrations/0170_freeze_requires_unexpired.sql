CREATE OR REPLACE FUNCTION public.freeze_membership(p_membership_id uuid, p_freeze_days integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_m   record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.has_capability(v_uid,'freeze_membership') THEN
    RAISE EXCEPTION 'permission denied: freeze_membership';
  END IF;
  IF p_freeze_days IS NULL OR p_freeze_days < 1 THEN
    RAISE EXCEPTION 'freeze_days must be >= 1';
  END IF;

  SELECT * INTO v_m FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'membership % not found', p_membership_id; END IF;
  IF v_m.status NOT IN ('active') THEN
    RAISE EXCEPTION 'only active memberships can be frozen (current: %)', v_m.status;
  END IF;
  IF v_m.end_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'membership_not_covering_date: This membership ended on %. Renew before freezing.', to_char(v_m.end_date, 'DD Mon');
  END IF;

  UPDATE public.memberships
     SET status = 'frozen',
         freeze_start_date = CURRENT_DATE,
         freeze_end_date   = CURRENT_DATE + p_freeze_days,
         freeze_reason     = p_reason,
         end_date          = end_date + p_freeze_days
   WHERE id = p_membership_id;

  RETURN jsonb_build_object(
    'membership_id', p_membership_id,
    'freeze_days', p_freeze_days,
    'new_end_date', (v_m.end_date + p_freeze_days)
  );
END;
$function$;