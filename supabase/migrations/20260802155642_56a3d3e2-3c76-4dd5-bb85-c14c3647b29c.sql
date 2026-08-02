-- 1) shift_date on staff attendance
ALTER TABLE public.staff_attendance ADD COLUMN IF NOT EXISTS shift_date date;
CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_shift_date
  ON public.staff_attendance(user_id, shift_date);

-- 2) roster lookup helper for a specific date
CREATE OR REPLACE FUNCTION public._staff_roster_for_date(p_user_id uuid, p_date date)
RETURNS TABLE(m_start time, m_end time, e_start time, e_end time, is_off boolean, branch_id uuid, grace_min integer, has_schedule boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT * INTO v_row
  FROM public.staff_shift_overrides
  WHERE user_id = p_user_id AND date = p_date
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_row.morning_start, v_row.morning_end, v_row.evening_start, v_row.evening_end,
                        COALESCE(v_row.is_weekly_off,false), v_row.branch_id, NULL::int, true;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.staff_shifts
  WHERE user_id = p_user_id AND weekday = EXTRACT(DOW FROM p_date)::int
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::time, NULL::time, NULL::time, NULL::time, false, NULL::uuid, NULL::int, false;
    RETURN;
  END IF;

  RETURN QUERY SELECT COALESCE(v_row.morning_start, v_row.start_time),
                      COALESCE(v_row.morning_end, v_row.end_time),
                      v_row.evening_start, v_row.evening_end,
                      COALESCE(v_row.is_weekly_off,false), v_row.branch_id,
                      v_row.late_grace_min, true;
END;
$$;

-- 3) overnight-aware shift resolver
DROP FUNCTION IF EXISTS public.resolve_staff_shift(uuid, timestamptz, uuid);

CREATE FUNCTION public.resolve_staff_shift(p_user_id uuid, p_ts timestamptz, p_branch_id uuid DEFAULT NULL)
RETURNS TABLE(shift_type public.attendance_shift_type, scheduled_start time, grace_min integer,
              is_off boolean, has_schedule boolean, shift_date date, is_overnight boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_local timestamp;
  v_date date;
  v_time time;
  v_prev date;
  r RECORD;
  v_grace int;
  v_pick_start time;
  v_pick_end time;
  v_type public.attendance_shift_type;
  v_ovn boolean := false;
BEGIN
  v_local := (p_ts AT TIME ZONE 'Asia/Kolkata');
  v_date := v_local::date;
  v_time := v_local::time;
  v_prev := v_date - 1;

  -- (a) does this punch belong to yesterday's overnight block?
  SELECT * INTO r FROM public._staff_roster_for_date(p_user_id, v_prev);
  IF r.has_schedule AND NOT r.is_off THEN
    v_pick_start := NULL;
    IF r.e_start IS NOT NULL AND r.e_end IS NOT NULL AND r.e_end < r.e_start THEN
      v_pick_start := r.e_start; v_pick_end := r.e_end;
    ELSIF r.m_start IS NOT NULL AND r.m_end IS NOT NULL AND r.m_end < r.m_start THEN
      v_pick_start := r.m_start; v_pick_end := r.m_end;
    END IF;

    IF v_pick_start IS NOT NULL AND v_time < v_pick_end THEN
      v_grace := r.grace_min;
      IF v_grace IS NULL THEN
        SELECT hs.late_grace_min INTO v_grace FROM public.hr_settings hs
        WHERE hs.branch_id = COALESCE(p_branch_id, r.branch_id) LIMIT 1;
      END IF;
      RETURN QUERY SELECT 'night'::public.attendance_shift_type, v_pick_start,
                          COALESCE(v_grace,10), false, true, v_prev, true;
      RETURN;
    END IF;
  END IF;

  -- (b) today's roster
  SELECT * INTO r FROM public._staff_roster_for_date(p_user_id, v_date);

  v_grace := r.grace_min;
  IF v_grace IS NULL THEN
    SELECT hs.late_grace_min INTO v_grace FROM public.hr_settings hs
    WHERE hs.branch_id = COALESCE(p_branch_id, r.branch_id) LIMIT 1;
  END IF;
  v_grace := COALESCE(v_grace, 10);

  IF NOT r.has_schedule THEN
    RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::time, v_grace, false, false, v_date, false;
    RETURN;
  END IF;

  IF r.is_off THEN
    RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::time, v_grace, true, true, v_date, false;
    RETURN;
  END IF;

  IF r.m_start IS NULL AND r.e_start IS NULL THEN
    RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::time, v_grace, false, false, v_date, false;
    RETURN;
  END IF;

  IF r.e_start IS NOT NULL AND r.m_start IS NOT NULL THEN
    IF v_time >= (r.e_start - make_interval(mins => v_grace)) THEN
      v_pick_start := r.e_start; v_pick_end := r.e_end; v_type := 'evening';
    ELSE
      v_pick_start := r.m_start; v_pick_end := r.m_end; v_type := 'morning';
    END IF;
  ELSIF r.e_start IS NOT NULL THEN
    v_pick_start := r.e_start; v_pick_end := r.e_end; v_type := 'evening';
  ELSE
    v_pick_start := r.m_start; v_pick_end := r.m_end; v_type := 'morning';
    IF v_pick_end IS NOT NULL AND (v_pick_end - v_pick_start) >= interval '10 hours' THEN
      v_type := 'full_day';
    END IF;
  END IF;

  -- a block that ends before it starts is an overnight/night shift
  IF v_pick_end IS NOT NULL AND v_pick_end < v_pick_start THEN
    v_type := 'night';
    v_ovn := true;
  END IF;

  RETURN QUERY SELECT v_type, v_pick_start, v_grace, false, true, v_date, v_ovn;
END;
$$;

-- 4) stamp trigger: shift_date aware
CREATE OR REPLACE FUNCTION public.tg_stamp_staff_attendance_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_late INT;
  v_policy TEXT;
  v_is_repeat BOOLEAN;
BEGIN
  IF NEW.check_in IS NULL OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO r FROM public.resolve_staff_shift(NEW.user_id, NEW.check_in, NEW.branch_id);

  NEW.shift_type := COALESCE(r.shift_type, NEW.shift_type);
  NEW.scheduled_start := r.scheduled_start;
  NEW.shift_date := COALESCE(r.shift_date, (NEW.check_in AT TIME ZONE 'Asia/Kolkata')::date);

  IF r.is_off OR NOT r.has_schedule OR r.scheduled_start IS NULL THEN
    SELECT COALESCE(hs.unscheduled_punch_policy, 'unscheduled') INTO v_policy
    FROM public.hr_settings hs WHERE hs.branch_id = NEW.branch_id LIMIT 1;
    NEW.late_minutes := NULL;
    NEW.is_late := (COALESCE(v_policy, 'unscheduled') = 'late');
    RETURN NEW;
  END IF;

  v_late := FLOOR(EXTRACT(EPOCH FROM (
    ((NEW.check_in AT TIME ZONE 'Asia/Kolkata')::TIME - r.scheduled_start)
  )) / 60)::INT;
  IF v_late < -720 THEN v_late := v_late + 1440; END IF;

  -- only the first punch of a shift block counts for lateness
  SELECT EXISTS (
    SELECT 1 FROM public.staff_attendance sa
    WHERE sa.user_id = NEW.user_id
      AND sa.id <> NEW.id
      AND sa.check_in IS NOT NULL
      AND sa.check_in < NEW.check_in
      AND COALESCE(sa.shift_type, 'full_day') = COALESCE(NEW.shift_type, 'full_day')
      AND sa.shift_date = NEW.shift_date
  ) INTO v_is_repeat;

  NEW.late_minutes := v_late;
  -- a punch that continues an overnight shift is never a "late arrival"
  NEW.is_late := (NOT v_is_repeat) AND (NOT COALESCE(r.is_overnight,false) OR v_late <= 720)
                 AND v_late > COALESCE(r.grace_min, 10);
  RETURN NEW;
END;
$$;

-- 5) auto-close stale staff attendance rows
CREATE OR REPLACE FUNCTION public.auto_close_stale_staff_attendance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.staff_attendance
     SET check_out = check_in + interval '12 hours',
         notes = COALESCE(notes,'') ||
                 CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE ' | ' END ||
                 'auto-closed: no exit scan'
   WHERE check_out IS NULL
     AND check_in < now() - interval '14 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_close_stale_staff_attendance() TO service_role;

-- 6) backfill shift_date
UPDATE public.staff_attendance sa
   SET shift_date = COALESCE(
         (SELECT r.shift_date FROM public.resolve_staff_shift(sa.user_id, sa.check_in, sa.branch_id) r LIMIT 1),
         (sa.check_in AT TIME ZONE 'Asia/Kolkata')::date)
 WHERE sa.shift_date IS NULL;

-- 7) register auto-close in Automation Brain
INSERT INTO public.automation_rules (branch_id, key, name, description, category, worker, cron_expression, is_active, is_system)
SELECT NULL, 'auto_close_staff_attendance', 'Auto-close staff attendance',
       'Closes staff attendance rows left open past their shift so hours stop accumulating.',
       'system', 'rpc:auto_close_stale_staff_attendance', '*/30 * * * *', true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.automation_rules WHERE key = 'auto_close_staff_attendance' AND branch_id IS NULL
);