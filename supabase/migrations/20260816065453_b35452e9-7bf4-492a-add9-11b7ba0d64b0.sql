CREATE OR REPLACE FUNCTION public.staff_roster_board(p_branch_id uuid, p_date date)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  avatar_url text,
  staff_code text,
  staff_kind text,
  shift_type text,
  scheduled_start time,
  scheduled_end time,
  rostered boolean,
  attendance_id uuid,
  check_in timestamptz,
  is_late boolean,
  late_minutes int,
  source text,
  mark_state text,
  mark_reason text,
  state text,
  rostered_hours numeric,
  hours numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  b RECORD;
  v_any boolean;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  FOR s IN
    SELECT DISTINCT ON (x.user_id) x.user_id, x.code, x.kind
    FROM (
      SELECT e.user_id, e.employee_code AS code, 'staff'::text AS kind
        FROM public.employees e
       WHERE e.branch_id = p_branch_id AND e.is_active AND e.user_id IS NOT NULL
      UNION ALL
      SELECT t.user_id, 'Trainer'::text, 'trainer'::text
        FROM public.trainers t
       WHERE t.branch_id = p_branch_id AND t.is_active AND t.user_id IS NOT NULL
    ) x
  LOOP
    v_any := false;
    FOR b IN SELECT * FROM public.staff_day_blocks(s.user_id, p_date) LOOP
      v_any := true;
      user_id := s.user_id; staff_code := s.code; staff_kind := s.kind;
      SELECT p.full_name, p.avatar_url INTO full_name, avatar_url
        FROM public.profiles p WHERE p.id = s.user_id;
      shift_type := b.shift_type; scheduled_start := b.scheduled_start;
      scheduled_end := b.scheduled_end; rostered := b.rostered;
      attendance_id := b.attendance_id; check_in := b.check_in;
      is_late := b.is_late; late_minutes := b.late_minutes; source := b.source;
      mark_state := b.mark_state; mark_reason := b.mark_reason; state := b.state;
      rostered_hours := b.rostered_hours; hours := b.hours;
      RETURN NEXT;
    END LOOP;

    IF NOT v_any THEN
      user_id := s.user_id; staff_code := s.code; staff_kind := s.kind;
      SELECT p.full_name, p.avatar_url INTO full_name, avatar_url
        FROM public.profiles p WHERE p.id = s.user_id;
      shift_type := NULL; scheduled_start := NULL; scheduled_end := NULL;
      rostered := false; attendance_id := NULL; check_in := NULL;
      is_late := false; late_minutes := NULL; source := NULL;
      mark_state := NULL; mark_reason := NULL; state := 'off';
      rostered_hours := 0; hours := 0;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.staff_roster_board(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_month_summary(p_branch_id uuid, p_month date)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  avatar_url text,
  staff_code text,
  staff_kind text,
  present_days int,
  half_days int,
  absent_days int,
  leave_days int,
  off_days int,
  blocks_rostered int,
  blocks_attended int,
  payable_days numeric,
  hours numeric,
  late_count int
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s RECORD;
  v_start date := date_trunc('month', p_month)::date;
  v_end date := LEAST((date_trunc('month', p_month) + interval '1 month - 1 day')::date,
                      (now() AT TIME ZONE 'Asia/Kolkata')::date);
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF v_end < v_start THEN RETURN; END IF;

  FOR s IN
    SELECT DISTINCT ON (x.user_id) x.user_id, x.code, x.kind
    FROM (
      SELECT e.user_id, e.employee_code AS code, 'staff'::text AS kind
        FROM public.employees e
       WHERE e.branch_id = p_branch_id AND e.is_active AND e.user_id IS NOT NULL
      UNION ALL
      SELECT t.user_id, 'Trainer'::text, 'trainer'::text
        FROM public.trainers t
       WHERE t.branch_id = p_branch_id AND t.is_active AND t.user_id IS NOT NULL
    ) x
  LOOP
    user_id := s.user_id; staff_code := s.code; staff_kind := s.kind;
    SELECT p.full_name, p.avatar_url INTO full_name, avatar_url
      FROM public.profiles p WHERE p.id = s.user_id;

    SELECT
      COALESCE(SUM(CASE WHEN c.status = 'present' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN c.status = 'half_day' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN c.status = 'absent' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN c.status = 'leave' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN c.status IN ('weekly_off','holiday') THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(c.blocks_rostered), 0),
      COALESCE(SUM(c.blocks_attended), 0),
      COALESCE(SUM(CASE WHEN c.status IN ('present','half_day') THEN c.payable_fraction ELSE 0 END), 0),
      COALESCE(SUM(c.hours_worked), 0),
      COALESCE(SUM(CASE WHEN c.is_late THEN 1 ELSE 0 END), 0)
    INTO present_days, half_days, absent_days, leave_days, off_days,
         blocks_rostered, blocks_attended, payable_days, hours, late_count
    FROM public.compute_payroll(s.user_id, v_start, v_end, NULL) c;

    RETURN NEXT;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.staff_month_summary(uuid, date) TO authenticated, service_role;