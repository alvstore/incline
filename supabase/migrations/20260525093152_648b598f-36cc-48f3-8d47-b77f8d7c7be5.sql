
-- ============================================================
-- staff_shifts: split-shift columns
-- ============================================================
ALTER TABLE public.staff_shifts
  ADD COLUMN IF NOT EXISTS morning_start time,
  ADD COLUMN IF NOT EXISTS morning_end   time,
  ADD COLUMN IF NOT EXISTS evening_start time,
  ADD COLUMN IF NOT EXISTS evening_end   time;

-- Allow legacy single-shift fields to be NULL (new roster rows use morning_/evening_)
ALTER TABLE public.staff_shifts ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE public.staff_shifts ALTER COLUMN end_time   DROP NOT NULL;
ALTER TABLE public.staff_shifts ALTER COLUMN start_time DROP DEFAULT;
ALTER TABLE public.staff_shifts ALTER COLUMN end_time   DROP DEFAULT;

-- Validation trigger (CHECK constraints can't be added cleanly with existing data; trigger is safer)
CREATE OR REPLACE FUNCTION public.validate_staff_shift_blocks()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_weekly_off THEN
    RETURN NEW;
  END IF;

  -- Each populated block must have both ends
  IF (NEW.morning_start IS NULL) <> (NEW.morning_end IS NULL) THEN
    RAISE EXCEPTION 'Morning shift requires both start and end times';
  END IF;
  IF (NEW.evening_start IS NULL) <> (NEW.evening_end IS NULL) THEN
    RAISE EXCEPTION 'Evening shift requires both start and end times';
  END IF;

  -- At least one block (split-shift OR legacy single-shift) must be populated
  IF NEW.morning_start IS NULL
     AND NEW.evening_start IS NULL
     AND NEW.start_time   IS NULL THEN
    RAISE EXCEPTION 'At least one shift block must be defined (or mark as weekly off)';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_validate_staff_shift_blocks ON public.staff_shifts;
CREATE TRIGGER tg_validate_staff_shift_blocks
  BEFORE INSERT OR UPDATE ON public.staff_shifts
  FOR EACH ROW EXECUTE FUNCTION public.validate_staff_shift_blocks();

-- ============================================================
-- staff_attendance: shift_type + total_hours
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.attendance_shift_type AS ENUM ('morning','evening','night','full_day');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS shift_type public.attendance_shift_type NOT NULL DEFAULT 'full_day',
  ADD COLUMN IF NOT EXISTS total_hours numeric(6,2);

-- Replace the global "one-open-per-user" partial index with one scoped to shift_type,
-- so a trainer can have morning closed AND evening open on the same day.
DROP INDEX IF EXISTS public.staff_attendance_one_active_per_user;
DROP INDEX IF EXISTS public.staff_attendance_one_open_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS staff_attendance_one_open_per_shift_uidx
  ON public.staff_attendance (user_id, shift_type)
  WHERE check_out IS NULL;

CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_checkin
  ON public.staff_attendance (user_id, check_in DESC);

-- ============================================================
-- RPC: calculate_shift_hours (handles overnight natively via tstz arithmetic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.calculate_shift_hours(
  p_clock_in  timestamptz,
  p_clock_out timestamptz
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_clock_in IS NULL OR p_clock_out IS NULL THEN NULL
    ELSE ROUND( (EXTRACT(EPOCH FROM (p_clock_out - p_clock_in)) / 3600.0)::numeric, 2)
  END;
$$;

-- Trigger: fill total_hours on check-out
CREATE OR REPLACE FUNCTION public.tg_fill_attendance_total_hours()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.check_out IS NOT NULL THEN
    NEW.total_hours := public.calculate_shift_hours(NEW.check_in, NEW.check_out);
  ELSE
    NEW.total_hours := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_staff_attendance_total_hours ON public.staff_attendance;
CREATE TRIGGER tg_staff_attendance_total_hours
  BEFORE INSERT OR UPDATE ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_fill_attendance_total_hours();

-- ============================================================
-- RPC: punch_duty — atomic clock-in / clock-out for current user
-- ============================================================
CREATE OR REPLACE FUNCTION public.punch_duty(
  p_shift_type text DEFAULT 'full_day',
  p_branch_id  uuid DEFAULT NULL
) RETURNS public.staff_attendance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_open  public.staff_attendance%ROWTYPE;
  v_row   public.staff_attendance%ROWTYPE;
  v_branch uuid := p_branch_id;
  v_shift public.attendance_shift_type;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  BEGIN
    v_shift := p_shift_type::public.attendance_shift_type;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Invalid shift_type: %', p_shift_type;
  END;

  -- Find existing open punch for this user+shift
  SELECT * INTO v_open
    FROM public.staff_attendance
   WHERE user_id = v_uid
     AND shift_type = v_shift
     AND check_out IS NULL
   ORDER BY check_in DESC
   LIMIT 1
   FOR UPDATE;

  IF FOUND THEN
    -- Clock out
    UPDATE public.staff_attendance
       SET check_out = now()
     WHERE id = v_open.id
     RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  -- Clock in — resolve branch
  IF v_branch IS NULL THEN
    SELECT branch_id INTO v_branch
      FROM public.profiles
     WHERE id = v_uid;
  END IF;

  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'No branch resolved for punch-in';
  END IF;

  INSERT INTO public.staff_attendance (user_id, branch_id, check_in, shift_type)
  VALUES (v_uid, v_branch, now(), v_shift)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.punch_duty(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.punch_duty(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_shift_hours(timestamptz, timestamptz) TO authenticated;

-- Backfill total_hours for existing closed rows
UPDATE public.staff_attendance
   SET total_hours = public.calculate_shift_hours(check_in, check_out)
 WHERE check_out IS NOT NULL AND total_hours IS NULL;
