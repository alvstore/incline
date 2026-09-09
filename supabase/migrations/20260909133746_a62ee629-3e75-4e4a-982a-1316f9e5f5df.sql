CREATE OR REPLACE FUNCTION public.staff_gate_check_out(_staff_id uuid, _branch_id uuid, _at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.staff_attendance%ROWTYPE;
  _floor timestamptz := _at - interval '18 hours';
BEGIN
  SELECT * INTO _row
  FROM public.staff_attendance
  WHERE employee_id = _staff_id
    AND check_out IS NULL
    AND check_in <= _at
    AND check_in >= _floor
    AND (_branch_id IS NULL OR branch_id IS NULL OR branch_id = _branch_id)
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    IF _at - _row.check_in < interval '1 minute' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Exit scan too close to entry scan; ignored');
    END IF;

    UPDATE public.staff_attendance
    SET check_out = _at,
        total_hours = ROUND(EXTRACT(EPOCH FROM (_at - _row.check_in))/3600.0, 2)
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  SELECT * INTO _row
  FROM public.staff_attendance
  WHERE employee_id = _staff_id
    AND check_out IS NOT NULL
    AND check_in <= _at
    AND check_in >= _floor
    AND (_branch_id IS NULL OR branch_id IS NULL OR branch_id = _branch_id)
    AND _at - check_out <= interval '4 hours'
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND _at > _row.check_out THEN
    UPDATE public.staff_attendance
    SET check_out = _at,
        total_hours = ROUND(EXTRACT(EPOCH FROM (_at - _row.check_in))/3600.0, 2)
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id, 'extended', true,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  RETURN jsonb_build_object('success', false, 'message', 'No open shift to close');
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_gate_check_out(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_gate_check_out(uuid, uuid, timestamptz) TO service_role;