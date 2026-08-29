-- 1. Configurable pre-shift matching window (minutes before a block's start
--    within which an early punch is still attributed to that block).
ALTER TABLE public.hr_settings
  ADD COLUMN IF NOT EXISTS pre_shift_match_min integer NOT NULL DEFAULT 120;

-- 2. Roster resolution: an override day inherits the weekly roster's grace.
CREATE OR REPLACE FUNCTION public._staff_roster_for_date(p_user_id uuid, p_date date)
 RETURNS TABLE(m_start time without time zone, m_end time without time zone, e_start time without time zone, e_end time without time zone, is_off boolean, branch_id uuid, grace_min integer, has_schedule boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
  v_weekly RECORD;
BEGIN
  -- Precedence: staff_shift_overrides (specific date) > staff_shifts (weekday).
  -- employees.weekly_off / trainers.weekly_off are legacy metadata and never
  -- override an explicit roster assignment.
  SELECT * INTO v_row
  FROM public.staff_shift_overrides
  WHERE user_id = p_user_id AND date = p_date
  LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_weekly
    FROM public.staff_shifts
    WHERE user_id = p_user_id AND weekday = EXTRACT(DOW FROM p_date)::int
    LIMIT 1;

    RETURN QUERY SELECT v_row.morning_start, v_row.morning_end, v_row.evening_start, v_row.evening_end,
                        COALESCE(v_row.is_weekly_off,false), v_row.branch_id,
                        v_weekly.late_grace_min, true;
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
$function$;

-- 3. Canonical shift resolver.
--
--    Dual-shift selection algorithm (the bug being fixed): the evening block is
--    chosen when the punch time reaches the EARLIER of
--      a) evening_start - pre_shift_match_min   (early-arrival window), or
--      b) the midpoint of the gap between morning_end and evening_start.
--    Otherwise the morning block is used. The old rule used
--    evening_start - grace (15 min), so a 16:57 punch for a 06:00/18:00 roster
--    was measured against 06:00 and reported as 657 minutes late.
CREATE OR REPLACE FUNCTION public.resolve_staff_shift(p_user_id uuid, p_ts timestamp with time zone, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(shift_type attendance_shift_type, scheduled_start time without time zone, grace_min integer, is_off boolean, has_schedule boolean, shift_date date, is_overnight boolean)
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
  v_grace int;
  v_pre int;
  v_hr RECORD;
  v_pick_start time;
  v_pick_end time;
  v_type public.attendance_shift_type;
  v_ovn boolean := false;
  v_threshold time;
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
      SELECT hs.late_grace_min INTO v_grace FROM public.hr_settings hs
      WHERE hs.branch_id = COALESCE(p_branch_id, r.branch_id) LIMIT 1;
      RETURN QUERY SELECT 'night'::public.attendance_shift_type, v_pick_start,
                          COALESCE(r.grace_min, v_grace, 15), false, true, v_prev, true;
      RETURN;
    END IF;
  END IF;

  -- (b) today's roster
  SELECT * INTO r FROM public._staff_roster_for_date(p_user_id, v_date);

  SELECT hs.late_grace_min, hs.pre_shift_match_min INTO v_hr
  FROM public.hr_settings hs
  WHERE hs.branch_id = COALESCE(p_branch_id, r.branch_id) LIMIT 1;

  -- Grace precedence: roster block > branch HR settings > 15.
  v_grace := COALESCE(r.grace_min, v_hr.late_grace_min, 15);
  v_pre   := COALESCE(v_hr.pre_shift_match_min, 120);

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
    v_threshold := r.e_start - make_interval(mins => v_pre);
    IF r.m_end IS NOT NULL AND r.m_end < r.e_start THEN
      v_threshold := LEAST(
        v_threshold,
        r.m_end + ((r.e_start - r.m_end) / 2)
      );
    END IF;

    IF v_time >= v_threshold THEN
      v_pick_start := r.e_start; v_pick_end := r.e_end; v_type := 'evening';
    ELSE
      v_pick_start := r.m_start; v_pick_end := r.m_end; v_type := 'morning';
    END IF;
  ELSIF r.e_start IS NOT NULL THEN
    v_pick_start := r.e_start; v_pick_end := r.e_end; v_type := 'evening';
  ELSE
    v_pick_start := r.m_start; v_pick_end := r.m_end; v_type := 'morning';
  END IF;

  -- A single block spanning >= 10 hours is a full-day shift, not "morning".
  IF v_pick_end IS NOT NULL AND v_pick_end > v_pick_start
     AND (v_pick_end - v_pick_start) >= interval '10 hours' THEN
    v_type := 'full_day';
  END IF;

  -- A block that ends before it starts is an overnight/night shift.
  IF v_pick_end IS NOT NULL AND v_pick_end < v_pick_start THEN
    v_type := 'night';
    v_ovn := true;
  END IF;

  RETURN QUERY SELECT v_type, v_pick_start, v_grace, false, true, v_date, v_ovn;
END;
$function$;

-- 4. Corrections must recompute lateness, not leave stale values.
--    The BEFORE UPDATE OF check_in trigger re-stamps shift_type / shift_date /
--    scheduled_start / late_minutes / is_late; force it to run even when the
--    caller only changes notes by always re-assigning check_in.
CREATE OR REPLACE FUNCTION public.staff_correct_attendance(p_id uuid, p_check_in timestamp with time zone DEFAULT NULL::timestamp with time zone, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to correct attendance';
  END IF;

  UPDATE public.staff_attendance
  SET check_in = COALESCE(p_check_in, check_in),
      notes = COALESCE(p_notes, notes),
      source = 'corrected',
      corrected_by = auth.uid(),
      corrected_at = now()
  WHERE id = p_id;

  RETURN p_id;
END;
$function$;