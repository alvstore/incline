-- 1. New datetime columns on staff_attendance
ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS scheduled_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end_at timestamptz;

-- 2. Resolver: return real datetimes and pick the best candidate block
DROP FUNCTION IF EXISTS public.resolve_staff_shift(uuid, timestamptz, uuid);

CREATE FUNCTION public.resolve_staff_shift(
  p_user_id uuid,
  p_ts timestamptz,
  p_branch_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  shift_type public.attendance_shift_type,
  scheduled_start time without time zone,
  grace_min integer,
  is_off boolean,
  has_schedule boolean,
  shift_date date,
  is_overnight boolean,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_local timestamp;
  v_date date;
  v_time time;
  v_prev date;
  r RECORD;
  rp RECORD;
  v_grace int;
  v_pre int;
  v_hr RECORD;
  v_threshold time;

  -- previous-day overnight candidate
  p_has boolean := false;
  p_start time; p_end time; p_start_at timestamptz; p_end_at timestamptz;
  p_score numeric;

  -- current-day candidate
  c_has boolean := false;
  c_start time; c_end time; c_type public.attendance_shift_type;
  c_start_at timestamptz; c_end_at timestamptz; c_ovn boolean := false;
  c_score numeric;
BEGIN
  v_local := (p_ts AT TIME ZONE 'Asia/Kolkata');
  v_date  := v_local::date;
  v_time  := v_local::time;
  v_prev  := v_date - 1;

  -- ---------- previous day's overnight candidate ----------
  SELECT * INTO rp FROM public._staff_roster_for_date(p_user_id, v_prev);
  IF rp.has_schedule AND NOT rp.is_off THEN
    IF rp.e_start IS NOT NULL AND rp.e_end IS NOT NULL AND rp.e_end < rp.e_start THEN
      p_start := rp.e_start; p_end := rp.e_end; p_has := true;
    ELSIF rp.m_start IS NOT NULL AND rp.m_end IS NOT NULL AND rp.m_end < rp.m_start THEN
      p_start := rp.m_start; p_end := rp.m_end; p_has := true;
    END IF;
  END IF;

  IF p_has THEN
    p_start_at := (v_prev + p_start) AT TIME ZONE 'Asia/Kolkata';
    p_end_at   := ((v_prev + 1) + p_end) AT TIME ZONE 'Asia/Kolkata';
  END IF;

  -- ---------- today's roster ----------
  SELECT * INTO r FROM public._staff_roster_for_date(p_user_id, v_date);

  SELECT hs.late_grace_min, hs.pre_shift_match_min INTO v_hr
  FROM public.hr_settings hs
  WHERE hs.branch_id = COALESCE(p_branch_id, r.branch_id, rp.branch_id) LIMIT 1;

  -- Grace precedence: roster block > branch HR settings > 15.
  v_grace := COALESCE(r.grace_min, rp.grace_min, v_hr.late_grace_min, 15);
  v_pre   := COALESCE(v_hr.pre_shift_match_min, 120);

  IF r.has_schedule AND NOT r.is_off AND (r.m_start IS NOT NULL OR r.e_start IS NOT NULL) THEN
    IF r.e_start IS NOT NULL AND r.m_start IS NOT NULL THEN
      v_threshold := r.e_start - make_interval(mins => v_pre);
      IF r.m_end IS NOT NULL AND r.m_end < r.e_start THEN
        v_threshold := LEAST(v_threshold, r.m_end + ((r.e_start - r.m_end) / 2));
      END IF;

      IF v_time >= v_threshold THEN
        c_start := r.e_start; c_end := r.e_end; c_type := 'evening';
      ELSE
        c_start := r.m_start; c_end := r.m_end; c_type := 'morning';
      END IF;
    ELSIF r.e_start IS NOT NULL THEN
      c_start := r.e_start; c_end := r.e_end; c_type := 'evening';
    ELSE
      c_start := r.m_start; c_end := r.m_end; c_type := 'morning';
    END IF;

    -- a single block spanning >= 10 hours is a full-day shift
    IF c_end IS NOT NULL AND c_end > c_start AND (c_end - c_start) >= interval '10 hours' THEN
      c_type := 'full_day';
    END IF;

    -- a block that ends before it starts is an overnight/night shift
    IF c_end IS NOT NULL AND c_end < c_start THEN
      c_type := 'night'; c_ovn := true;
    END IF;

    c_has := true;
    c_start_at := (v_date + c_start) AT TIME ZONE 'Asia/Kolkata';
    IF c_end IS NOT NULL THEN
      c_end_at := (CASE WHEN c_ovn THEN (v_date + 1) ELSE v_date END + c_end) AT TIME ZONE 'Asia/Kolkata';
    END IF;
  END IF;

  -- ---------- choose the best candidate ----------
  IF p_has THEN
    p_score := CASE
      WHEN p_ts >= p_start_at AND p_ts <= p_end_at THEN 0
      ELSE ABS(EXTRACT(EPOCH FROM (p_ts - p_start_at)))
    END;
  END IF;

  IF c_has THEN
    c_score := CASE
      WHEN p_ts >= (c_start_at - make_interval(mins => v_pre))
           AND (c_end_at IS NULL OR p_ts <= c_end_at) THEN 0
      ELSE ABS(EXTRACT(EPOCH FROM (p_ts - c_start_at)))
    END;
  END IF;

  -- previous night wins only when it is strictly the better match
  IF p_has AND (NOT c_has OR p_score < c_score) THEN
    RETURN QUERY SELECT 'night'::public.attendance_shift_type, p_start,
                        COALESCE(rp.grace_min, v_hr.late_grace_min, 15),
                        false, true, v_prev, true, p_start_at, p_end_at;
    RETURN;
  END IF;

  IF c_has THEN
    RETURN QUERY SELECT c_type, c_start, v_grace, false, true, v_date, c_ovn, c_start_at, c_end_at;
    RETURN;
  END IF;

  -- no usable block today
  IF NOT r.has_schedule THEN
    RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::time, v_grace,
                        false, false, v_date, false, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  IF r.is_off THEN
    RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::time, v_grace,
                        true, true, v_date, false, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::time, v_grace,
                      false, false, v_date, false, NULL::timestamptz, NULL::timestamptz;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_staff_shift(uuid, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_staff_shift(uuid, timestamptz, uuid) TO authenticated, service_role;

-- 3. Stamping trigger: real datetime lateness, single grace source
CREATE OR REPLACE FUNCTION public.tg_stamp_staff_attendance_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  NEW.shift_type        := COALESCE(r.shift_type, NEW.shift_type);
  NEW.scheduled_start   := r.scheduled_start;
  NEW.shift_date        := COALESCE(r.shift_date, (NEW.check_in AT TIME ZONE 'Asia/Kolkata')::date);
  NEW.scheduled_start_at := r.scheduled_start_at;
  NEW.scheduled_end_at   := r.scheduled_end_at;

  IF r.is_off OR NOT r.has_schedule OR r.scheduled_start_at IS NULL THEN
    SELECT COALESCE(hs.unscheduled_punch_policy, 'unscheduled') INTO v_policy
    FROM public.hr_settings hs WHERE hs.branch_id = NEW.branch_id LIMIT 1;
    NEW.late_minutes := NULL;
    NEW.is_late := (COALESCE(v_policy, 'unscheduled') = 'late');
    RETURN NEW;
  END IF;

  -- true instant difference; no midnight-wrap heuristic. negative = early.
  v_late := FLOOR(EXTRACT(EPOCH FROM (NEW.check_in - r.scheduled_start_at)) / 60)::INT;

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
  NEW.is_late := (NOT v_is_repeat) AND v_late > r.grace_min;
  RETURN NEW;
END;
$function$;

-- 4. Backfill existing rows
UPDATE public.staff_attendance
SET scheduled_start_at = (shift_date + scheduled_start) AT TIME ZONE 'Asia/Kolkata'
WHERE scheduled_start_at IS NULL
  AND shift_date IS NOT NULL
  AND scheduled_start IS NOT NULL;
