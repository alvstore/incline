CREATE OR REPLACE FUNCTION public.member_gate_check_out(_member_id uuid, _branch_id uuid, _at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.member_attendance%ROWTYPE;
BEGIN
  SELECT * INTO _row
  FROM public.member_attendance
  WHERE member_id = _member_id
    AND check_out IS NULL
    AND check_in <= _at
  ORDER BY check_in DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No open visit to close');
  END IF;

  -- ignore an exit scan that lands within a minute of the entry scan (double read)
  IF _at - _row.check_in < interval '1 minute' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Exit scan too close to entry scan; ignored');
  END IF;

  UPDATE public.member_attendance
  SET check_out = _at,
      check_out_method = 'biometric'
  WHERE id = _row.id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', _row.id,
    'check_in', _row.check_in,
    'check_out', _at,
    'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_gate_check_out(p_user_id uuid, p_branch_id uuid, p_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.staff_attendance%ROWTYPE;
BEGIN
  SELECT * INTO _row
  FROM public.staff_attendance
  WHERE user_id = p_user_id
    AND check_out IS NULL
    AND check_in <= p_at
  ORDER BY check_in DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'No open shift to close');
  END IF;

  IF p_at - _row.check_in < interval '1 minute' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Exit scan too close to entry scan; ignored');
  END IF;

  UPDATE public.staff_attendance
  SET check_out = p_at,
      total_hours = ROUND((EXTRACT(EPOCH FROM (p_at - _row.check_in))/3600)::numeric, 2)
  WHERE id = _row.id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', _row.id,
    'check_in', _row.check_in,
    'check_out', p_at,
    'duration_minutes', EXTRACT(EPOCH FROM (p_at - _row.check_in))/60
  );
END;
$$;

REVOKE ALL ON FUNCTION public.member_gate_check_out(uuid, uuid, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_gate_check_out(uuid, uuid, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_gate_check_out(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_gate_check_out(uuid, uuid, timestamptz) TO service_role;