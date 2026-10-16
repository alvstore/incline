CREATE OR REPLACE FUNCTION public.member_check_in(_member_id uuid, _branch_id uuid, _method text DEFAULT 'manual'::text, _at timestamptz DEFAULT NULL)
 RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_validation JSON;
  v_attendance_id UUID;
  v_at timestamptz := now();
BEGIN
  IF public.rpc_guard_applies('member_check_in') THEN
    PERFORM public.assert_branch_staff(_branch_id, true, 'member_check_in');
  ELSIF _at IS NOT NULL AND _at <= now() + interval '2 minutes' AND _at >= now() - interval '48 hours' THEN
    v_at := LEAST(_at, now());
  END IF;
  -- Same physical scan via webhook and poller (ms vs whole-second time): reuse the visit.
  SELECT id INTO v_attendance_id FROM public.member_attendance
   WHERE member_id = _member_id AND check_in BETWEEN v_at - interval '2 minutes' AND v_at + interval '2 minutes'
   ORDER BY check_in LIMIT 1;
  IF v_attendance_id IS NOT NULL THEN
    RETURN json_build_object('valid', true, 'success', true, 'attendance_id', v_attendance_id,
      'duplicate', true, 'message', 'Already checked in (duplicate scan)');
  END IF;
  v_validation := public.validate_member_checkin(_member_id, _branch_id);
  IF NOT (v_validation->>'valid')::BOOLEAN THEN
    RETURN v_validation;
  END IF;
  INSERT INTO public.member_attendance (member_id, membership_id, branch_id, check_in, check_in_method)
  VALUES (_member_id, (v_validation->>'membership_id')::UUID, _branch_id, v_at, _method)
  RETURNING id INTO v_attendance_id;
  RETURN json_build_object('valid', true, 'success', true, 'attendance_id', v_attendance_id,
    'message', 'Check-in successful', 'plan_name', v_validation->>'plan_name',
    'days_remaining', (v_validation->>'days_remaining')::INTEGER, 'check_in', v_at);
END;
$function$;