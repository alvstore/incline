CREATE OR REPLACE FUNCTION public.tg_stamp_staff_attendance_shift()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      AND (sa.check_in AT TIME ZONE 'Asia/Kolkata')::DATE
          = (NEW.check_in AT TIME ZONE 'Asia/Kolkata')::DATE
  ) INTO v_is_repeat;

  NEW.late_minutes := v_late;
  NEW.is_late := (NOT v_is_repeat) AND v_late > COALESCE(r.grace_min, 10);
  RETURN NEW;
END;
$$;

-- Recalculate the repeat-punch flag on existing rows
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY user_id, COALESCE(shift_type,'full_day'),
                        (check_in AT TIME ZONE 'Asia/Kolkata')::DATE
           ORDER BY check_in
         ) AS rn
  FROM public.staff_attendance
  WHERE check_in IS NOT NULL
)
UPDATE public.staff_attendance sa
   SET is_late = false
  FROM ranked
 WHERE ranked.id = sa.id AND ranked.rn > 1 AND sa.is_late;