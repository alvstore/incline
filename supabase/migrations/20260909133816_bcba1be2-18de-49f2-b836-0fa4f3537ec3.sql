CREATE OR REPLACE FUNCTION public.member_gate_check_out(_member_id uuid, _branch_id uuid, _at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.member_attendance%ROWTYPE;
  _floor timestamptz := _at - interval '12 hours';
BEGIN
  SELECT * INTO _row
  FROM public.member_attendance
  WHERE member_id = _member_id
    AND check_out IS NULL
    AND check_in <= _at
    AND check_in >= _floor
    AND (_branch_id IS NULL OR branch_id IS NULL OR branch_id = _branch_id)
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    IF _at - _row.check_in < interval '1 minute' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Exit scan too close to entry scan; ignored');
    END IF;

    UPDATE public.member_attendance
    SET check_out = _at, check_out_method = 'biometric'
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  -- LAST EXIT WINS within the same visit window.
  SELECT * INTO _row
  FROM public.member_attendance
  WHERE member_id = _member_id
    AND check_out IS NOT NULL
    AND check_in <= _at
    AND check_in >= _floor
    AND (_branch_id IS NULL OR branch_id IS NULL OR branch_id = _branch_id)
    AND _at - check_out <= interval '4 hours'
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND _at > _row.check_out THEN
    UPDATE public.member_attendance
    SET check_out = _at, check_out_method = 'biometric'
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id, 'extended', true,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  RETURN jsonb_build_object('success', false, 'message', 'No open visit to close');
END;
$function$;

REVOKE ALL ON FUNCTION public.member_gate_check_out(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_gate_check_out(uuid, uuid, timestamptz) TO service_role;