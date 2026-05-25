
-- Dedup: one staff_late alert per (recipient, attendance row)
CREATE UNIQUE INDEX IF NOT EXISTS notifications_staff_late_dedup_uidx
  ON public.notifications (user_id, category, (metadata->>'attendance_id'))
  WHERE category = 'staff_late';

CREATE OR REPLACE FUNCTION public.notify_late_attendance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weekday INT;
  v_shift RECORD;
  v_scheduled TIME;
  v_clock_in_time TIME;
  v_minutes_late INT;
  v_grace_minutes INT := 10;
  v_actor_name TEXT;
  v_branch_name TEXT;
  v_recipient UUID;
  v_title TEXT;
  v_message TEXT;
BEGIN
  IF NEW.check_in IS NULL OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only fire on insert, or when check_in transitioned from NULL → NOT NULL
  IF TG_OP = 'UPDATE' AND OLD.check_in IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_weekday := EXTRACT(DOW FROM (NEW.check_in AT TIME ZONE 'Asia/Kolkata'))::INT;
  v_clock_in_time := (NEW.check_in AT TIME ZONE 'Asia/Kolkata')::TIME;

  SELECT * INTO v_shift
  FROM public.staff_shifts
  WHERE user_id = NEW.user_id AND weekday = v_weekday
  LIMIT 1;

  IF NOT FOUND OR v_shift.is_weekly_off THEN
    RETURN NEW;
  END IF;

  -- Pick scheduled start based on shift_type
  v_scheduled := CASE
    WHEN NEW.shift_type = 'evening' THEN v_shift.evening_start
    WHEN NEW.shift_type = 'morning' THEN v_shift.morning_start
    ELSE COALESCE(v_shift.morning_start, v_shift.evening_start)
  END;

  IF v_scheduled IS NULL THEN
    RETURN NEW;
  END IF;

  v_minutes_late := EXTRACT(EPOCH FROM (v_clock_in_time - v_scheduled)) / 60;

  IF v_minutes_late <= v_grace_minutes THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, 'A staff member') INTO v_actor_name
  FROM public.profiles WHERE id = NEW.user_id;

  SELECT name INTO v_branch_name FROM public.branches WHERE id = NEW.branch_id;

  v_title := 'Late check-in';
  v_message := v_actor_name || ' clocked in ' || v_minutes_late || ' min late' ||
               COALESCE(' at ' || v_branch_name, '') || '.';

  -- Same-branch managers + all owners/admins
  FOR v_recipient IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    LEFT JOIN public.employees e ON e.user_id = ur.user_id
    WHERE
      (ur.role IN ('owner','admin'))
      OR (ur.role = 'manager' AND NEW.branch_id IS NOT NULL AND e.branch_id = NEW.branch_id)
  LOOP
    IF v_recipient = NEW.user_id THEN CONTINUE; END IF;
    BEGIN
      INSERT INTO public.notifications
        (user_id, branch_id, title, message, type, category, metadata)
      VALUES (
        v_recipient,
        NEW.branch_id,
        v_title,
        v_message,
        'warning',
        'staff_late',
        jsonb_build_object(
          'attendance_id', NEW.id,
          'staff_user_id', NEW.user_id,
          'shift_type', NEW.shift_type,
          'minutes_late', v_minutes_late,
          'scheduled_start', v_scheduled::TEXT,
          'clock_in', NEW.check_in
        )
      );
    EXCEPTION WHEN unique_violation THEN
      -- already alerted this recipient for this attendance row
      NULL;
    END;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_late_attendance ON public.staff_attendance;
CREATE TRIGGER trg_notify_late_attendance
  AFTER INSERT OR UPDATE OF check_in ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.notify_late_attendance();
