-- 1. Late policy settings on hr_settings
ALTER TABLE public.hr_settings
  ADD COLUMN IF NOT EXISTS late_grace_min INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS late_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS late_notify_managers BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS min_punch_gap_min INT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS unscheduled_punch_policy TEXT NOT NULL DEFAULT 'unscheduled';

-- 2. Stored lateness on attendance
ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS scheduled_start TIME,
  ADD COLUMN IF NOT EXISTS late_minutes INT,
  ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT false;

-- 3. Shared roster resolver
CREATE OR REPLACE FUNCTION public.resolve_staff_shift(
  p_user_id UUID,
  p_ts TIMESTAMPTZ,
  p_branch_id UUID DEFAULT NULL
)
RETURNS TABLE (
  shift_type public.attendance_shift_type,
  scheduled_start TIME,
  grace_min INT,
  is_off BOOLEAN,
  has_schedule BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local TIMESTAMP;
  v_date DATE;
  v_time TIME;
  v_weekday INT;
  v_row RECORD;
  v_grace INT;
  v_branch UUID;
  v_m_start TIME;
  v_m_end TIME;
  v_e_start TIME;
  v_e_end TIME;
  v_off BOOLEAN := false;
  v_pick_start TIME;
  v_pick_type public.attendance_shift_type;
BEGIN
  v_local := (p_ts AT TIME ZONE 'Asia/Kolkata');
  v_date := v_local::DATE;
  v_time := v_local::TIME;
  v_weekday := EXTRACT(DOW FROM v_local)::INT;

  -- per-date override wins
  SELECT * INTO v_row
  FROM public.staff_shift_overrides
  WHERE user_id = p_user_id AND date = v_date
  LIMIT 1;

  IF FOUND THEN
    v_m_start := v_row.morning_start; v_m_end := v_row.morning_end;
    v_e_start := v_row.evening_start; v_e_end := v_row.evening_end;
    v_off := COALESCE(v_row.is_weekly_off, false);
    v_branch := v_row.branch_id;
    v_grace := NULL;
  ELSE
    SELECT * INTO v_row
    FROM public.staff_shifts
    WHERE user_id = p_user_id AND weekday = v_weekday
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::TIME, 10, false, false;
      RETURN;
    END IF;

    v_m_start := COALESCE(v_row.morning_start, v_row.start_time);
    v_m_end := COALESCE(v_row.morning_end, v_row.end_time);
    v_e_start := v_row.evening_start;
    v_e_end := v_row.evening_end;
    v_off := COALESCE(v_row.is_weekly_off, false);
    v_branch := v_row.branch_id;
    v_grace := v_row.late_grace_min;
  END IF;

  -- effective grace: per-staff shift -> branch default -> 10
  IF v_grace IS NULL THEN
    SELECT hs.late_grace_min INTO v_grace
    FROM public.hr_settings hs
    WHERE hs.branch_id = COALESCE(p_branch_id, v_branch)
    LIMIT 1;
  END IF;
  v_grace := COALESCE(v_grace, 10);

  IF v_off THEN
    RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::TIME, v_grace, true, true;
    RETURN;
  END IF;

  IF v_m_start IS NULL AND v_e_start IS NULL THEN
    RETURN QUERY SELECT 'full_day'::public.attendance_shift_type, NULL::TIME, v_grace, false, false;
    RETURN;
  END IF;

  -- choose the block the punch belongs to
  IF v_e_start IS NOT NULL AND v_m_start IS NOT NULL THEN
    IF v_time >= (v_e_start - make_interval(mins => v_grace)) THEN
      v_pick_start := v_e_start; v_pick_type := 'evening';
    ELSE
      v_pick_start := v_m_start; v_pick_type := 'morning';
    END IF;
  ELSIF v_e_start IS NOT NULL THEN
    v_pick_start := v_e_start; v_pick_type := 'evening';
  ELSE
    v_pick_start := v_m_start;
    -- a single block that ends before it starts is a night shift
    IF v_m_end IS NOT NULL AND v_m_end < v_m_start THEN
      v_pick_type := 'night';
    ELSIF v_m_end IS NOT NULL AND (v_m_end - v_m_start) >= interval '10 hours' THEN
      v_pick_type := 'full_day';
    ELSE
      v_pick_type := 'morning';
    END IF;
  END IF;

  -- night shift: a punch in the small hours belongs to the previous day's block
  IF v_pick_type = 'night' AND v_time < v_m_end THEN
    RETURN QUERY SELECT v_pick_type, v_pick_start, v_grace, false, true;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_pick_type, v_pick_start, v_grace, false, true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_staff_shift(UUID, TIMESTAMPTZ, UUID) TO authenticated, service_role;

-- 4. Stamp shift + lateness before the row lands
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

  -- wrap for night shifts punching after midnight
  IF v_late < -720 THEN v_late := v_late + 1440; END IF;

  NEW.late_minutes := v_late;
  NEW.is_late := v_late > COALESCE(r.grace_min, 10);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stamp_staff_attendance_shift ON public.staff_attendance;
CREATE TRIGGER trg_stamp_staff_attendance_shift
  BEFORE INSERT OR UPDATE OF check_in ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_staff_attendance_shift();

-- 5. Roster-aware late notification
CREATE OR REPLACE FUNCTION public.notify_late_attendance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name TEXT;
  v_branch_name TEXT;
  v_recipient UUID;
  v_message TEXT;
  v_enabled BOOLEAN := true;
  v_notify_mgr BOOLEAN := true;
  v_gap INT := 60;
  v_shift_label TEXT;
BEGIN
  IF NEW.check_in IS NULL OR NEW.user_id IS NULL OR NOT COALESCE(NEW.is_late, false) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.check_in IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT hs.late_notifications_enabled, hs.late_notify_managers, hs.min_punch_gap_min
    INTO v_enabled, v_notify_mgr, v_gap
  FROM public.hr_settings hs WHERE hs.branch_id = NEW.branch_id LIMIT 1;

  v_enabled := COALESCE(v_enabled, true);
  v_notify_mgr := COALESCE(v_notify_mgr, true);
  v_gap := COALESCE(v_gap, 60);

  IF NOT v_enabled THEN RETURN NEW; END IF;

  -- repeat gate scan inside the same shift block: not a new late arrival
  IF EXISTS (
    SELECT 1 FROM public.staff_attendance sa
    WHERE sa.user_id = NEW.user_id
      AND sa.id <> NEW.id
      AND sa.check_in IS NOT NULL
      AND sa.shift_type = NEW.shift_type
      AND (sa.check_in AT TIME ZONE 'Asia/Kolkata')::DATE
          = (NEW.check_in AT TIME ZONE 'Asia/Kolkata')::DATE
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.check_in < now() - make_interval(mins => v_gap * 24) THEN
    RETURN NEW; -- backfilled/very old row, don't alert
  END IF;

  SELECT COALESCE(full_name, 'A staff member') INTO v_actor_name
  FROM public.profiles WHERE id = NEW.user_id;

  SELECT name INTO v_branch_name FROM public.branches WHERE id = NEW.branch_id;

  v_shift_label := REPLACE(NEW.shift_type::TEXT, '_', ' ');

  v_message := v_actor_name || ' clocked in ' || NEW.late_minutes || ' min late for the '
               || v_shift_label || ' shift'
               || COALESCE(' (' || to_char(NEW.scheduled_start, 'HH24:MI') || ')', '')
               || COALESCE(' at ' || v_branch_name, '') || '.';

  FOR v_recipient IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    LEFT JOIN public.employees e ON e.user_id = ur.user_id
    WHERE
      (ur.role IN ('owner','admin'))
      OR (v_notify_mgr AND ur.role = 'manager' AND NEW.branch_id IS NOT NULL AND e.branch_id = NEW.branch_id)
  LOOP
    IF v_recipient = NEW.user_id THEN CONTINUE; END IF;
    BEGIN
      INSERT INTO public.notifications
        (user_id, branch_id, title, message, type, category, metadata)
      VALUES (
        v_recipient, NEW.branch_id, 'Late check-in', v_message, 'warning', 'staff_late',
        jsonb_build_object(
          'attendance_id', NEW.id,
          'staff_user_id', NEW.user_id,
          'shift_type', NEW.shift_type,
          'minutes_late', NEW.late_minutes,
          'scheduled_start', NEW.scheduled_start::TEXT,
          'clock_in', NEW.check_in
        )
      );
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_late_attendance ON public.staff_attendance;
CREATE TRIGGER trg_notify_late_attendance
  AFTER INSERT OR UPDATE OF check_in ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.notify_late_attendance();

-- 6. Backfill existing attendance rows
DO $backfill$
DECLARE
  a RECORD;
  r RECORD;
  v_late INT;
BEGIN
  FOR a IN SELECT id, user_id, branch_id, check_in FROM public.staff_attendance WHERE check_in IS NOT NULL LOOP
    SELECT * INTO r FROM public.resolve_staff_shift(a.user_id, a.check_in, a.branch_id);
    IF r.scheduled_start IS NULL OR r.is_off OR NOT r.has_schedule THEN
      UPDATE public.staff_attendance
         SET shift_type = COALESCE(r.shift_type, shift_type),
             scheduled_start = NULL, late_minutes = NULL, is_late = false
       WHERE id = a.id;
    ELSE
      v_late := FLOOR(EXTRACT(EPOCH FROM (((a.check_in AT TIME ZONE 'Asia/Kolkata')::TIME - r.scheduled_start))) / 60)::INT;
      IF v_late < -720 THEN v_late := v_late + 1440; END IF;
      UPDATE public.staff_attendance
         SET shift_type = COALESCE(r.shift_type, shift_type),
             scheduled_start = r.scheduled_start,
             late_minutes = v_late,
             is_late = v_late > COALESCE(r.grace_min, 10)
       WHERE id = a.id;
    END IF;
  END LOOP;
END;
$backfill$;

-- 7. Mark previously sent bogus late alerts as read
UPDATE public.notifications
   SET is_read = true
 WHERE category = 'staff_late'
   AND COALESCE((metadata->>'minutes_late')::INT, 0) > 300;