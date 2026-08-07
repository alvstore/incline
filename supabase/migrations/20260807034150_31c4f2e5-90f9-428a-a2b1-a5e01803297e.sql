-- 1) Weekday guard inside book_facility_slot -------------------------------
CREATE OR REPLACE FUNCTION public.book_facility_slot(p_slot_id uuid, p_member_id uuid, p_membership_id uuid, p_source text DEFAULT 'member_portal'::text, p_staff_id uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false, p_force_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slot RECORD;
  v_facility RECORD;
  v_settings RECORD;
  v_member_gender text;
  v_existing_count integer;
  v_today_count integer;
  v_slot_dt timestamptz;
  v_window_hours integer;
  v_booking_id uuid;
  v_is_privileged boolean := false;
  v_maintenance boolean := false;
  v_enum public.benefit_type;
  v_avail integer;
  v_consume jsonb;
  v_day_abbr text;
  v_days text[];
  v_off_schedule boolean := false;
BEGIN
  IF p_source NOT IN ('member_portal','concierge','whatsapp_ai','admin','system') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid source');
  END IF;

  IF p_force THEN
    IF p_staff_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Force-add requires staff identity');
    END IF;
    SELECT (public.has_role(p_staff_id,'admin') OR public.has_role(p_staff_id,'owner') OR public.has_role(p_staff_id,'manager'))
      INTO v_is_privileged;
    IF NOT v_is_privileged THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only admin/owner/manager can force-add bookings');
    END IF;
  END IF;

  SELECT * INTO v_slot FROM benefit_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Slot not found');
  END IF;

  SELECT * INTO v_facility FROM facilities WHERE id = v_slot.facility_id LIMIT 1;

  IF v_facility.id IS NOT NULL
     AND (COALESCE(v_facility.under_maintenance, false) = true OR COALESCE(v_facility.is_active, true) = false) THEN
    v_maintenance := true;
    IF NOT p_force THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('%s is currently under maintenance and cannot be booked', COALESCE(v_facility.name, 'This facility')));
    END IF;
    IF COALESCE(btrim(p_force_reason), '') = '' THEN
      RETURN jsonb_build_object('success', false, 'error',
        'A reason is required to override a facility under maintenance');
    END IF;
  END IF;

  -- weekly schedule: the facility must actually run on this weekday
  IF v_facility.id IS NOT NULL THEN
    v_days := COALESCE(v_facility.available_days, ARRAY['mon','tue','wed','thu','fri','sat','sun']);
    v_day_abbr := lower(to_char(v_slot.slot_date, 'Dy'));
    IF NOT (v_day_abbr = ANY(v_days)) THEN
      v_off_schedule := true;
      IF NOT p_force THEN
        RETURN jsonb_build_object('success', false, 'error',
          format('%s does not run on %s. Scheduled days: %s',
                 COALESCE(v_facility.name, 'This facility'),
                 to_char(v_slot.slot_date, 'Day'),
                 upper(array_to_string(v_days, ' / '))));
      END IF;
      IF COALESCE(btrim(p_force_reason), '') = '' THEN
        RETURN jsonb_build_object('success', false, 'error',
          'A reason is required to book outside the facility weekly schedule');
      END IF;
    END IF;
  END IF;

  IF v_slot.is_active = false AND NOT p_force THEN
    RETURN jsonb_build_object('success', false, 'error', 'This slot is no longer available');
  END IF;

  IF NOT p_force AND v_slot.booked_count >= v_slot.capacity THEN
    RETURN jsonb_build_object('success', false, 'error', 'Slot is full');
  END IF;

  SELECT count(*) INTO v_existing_count
    FROM benefit_bookings
    WHERE slot_id = p_slot_id
      AND member_id = p_member_id
      AND status IN ('booked','attended');
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Member already booked for this slot');
  END IF;

  -- resolve the true benefit enum from the linked benefit type
  v_enum := v_slot.benefit_type;
  IF v_slot.benefit_type_id IS NOT NULL THEN
    SELECT public.safe_benefit_enum(bt.code)::public.benefit_type INTO v_enum
      FROM public.benefit_types bt WHERE bt.id = v_slot.benefit_type_id;
  END IF;
  v_enum := COALESCE(v_enum, v_slot.benefit_type);

  IF NOT p_force THEN
    SELECT * INTO v_settings
      FROM benefit_settings
      WHERE branch_id = v_slot.branch_id
        AND (
          (v_slot.benefit_type_id IS NOT NULL AND benefit_type_id = v_slot.benefit_type_id)
          OR (v_slot.benefit_type_id IS NULL AND benefit_type = v_enum)
        )
      LIMIT 1;

    v_window_hours := COALESCE(v_settings.booking_opens_hours_before, 168);
    v_slot_dt := (v_slot.slot_date::timestamp + v_slot.start_time) AT TIME ZONE 'Asia/Kolkata';

    IF v_slot_dt < now() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Slot has already started');
    END IF;

    IF v_slot_dt > now() + (v_window_hours || ' hours')::interval THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('Booking opens %s hours before the slot', v_window_hours));
    END IF;

    IF COALESCE(v_settings.max_bookings_per_day, 0) > 0 THEN
      SELECT count(*) INTO v_today_count
        FROM benefit_bookings bb
        JOIN benefit_slots bs ON bs.id = bb.slot_id
        WHERE bb.member_id = p_member_id
          AND bs.benefit_type_id IS NOT DISTINCT FROM v_slot.benefit_type_id
          AND bs.slot_date = v_slot.slot_date
          AND bb.status IN ('booked','attended');
      IF v_today_count >= v_settings.max_bookings_per_day THEN
        RETURN jsonb_build_object('success', false, 'error', 'Daily booking limit reached');
      END IF;
    END IF;

    IF v_facility.id IS NOT NULL AND v_facility.gender_access IS NOT NULL AND v_facility.gender_access <> 'unisex' THEN
      SELECT lower(p.gender::text) INTO v_member_gender
        FROM members m
        LEFT JOIN profiles p ON p.id = m.user_id
       WHERE m.id = p_member_id;
      IF v_member_gender IS NOT NULL AND v_member_gender <> lower(v_facility.gender_access) THEN
        RETURN jsonb_build_object('success', false, 'error',
          format('This facility is %s-only', v_facility.gender_access));
      END IF;
    END IF;

    -- entitlement gate: plan allowance, gifts or purchased credits must cover it
    v_avail := public.benefit_available_units(p_member_id, p_membership_id, v_enum, v_slot.benefit_type_id, v_slot.slot_date);
    IF v_avail = 0 THEN
      RETURN jsonb_build_object('success', false, 'error',
        'No sessions remaining for this benefit. Purchase an add-on package to book.');
    END IF;
  END IF;

  INSERT INTO benefit_bookings (
    slot_id, member_id, membership_id, status,
    booked_by_staff_id, source, force_added, force_reason
  ) VALUES (
    p_slot_id, p_member_id, p_membership_id, 'booked',
    p_staff_id, p_source, p_force, p_force_reason
  ) RETURNING id INTO v_booking_id;

  UPDATE benefit_slots SET booked_count = booked_count + 1 WHERE id = p_slot_id;

  -- deduct the session now (reservation)
  v_consume := public._consume_benefit_for_booking(v_booking_id, p_force);
  IF COALESCE((v_consume->>'success')::boolean, false) = false THEN
    RAISE EXCEPTION 'No sessions remaining for this benefit';
  END IF;

  IF v_maintenance OR v_off_schedule THEN
    BEGIN
      INSERT INTO booking_audit_log (booking_id, event_type, to_status, actor_id, reason, metadata)
      VALUES (v_booking_id,
              CASE WHEN v_maintenance THEN 'maintenance_override' ELSE 'schedule_override' END,
              'booked', p_staff_id, p_force_reason,
              jsonb_build_object('facility_id', v_facility.id, 'facility_name', v_facility.name,
                                 'slot_id', p_slot_id, 'off_schedule', v_off_schedule));

      INSERT INTO audit_logs (branch_id, user_id, action, table_name, record_id, new_data, action_description, target_name)
      VALUES (v_slot.branch_id, p_staff_id,
              CASE WHEN v_maintenance THEN 'maintenance_override' ELSE 'schedule_override' END,
              'benefit_bookings', v_booking_id,
              jsonb_build_object('facility_id', v_facility.id, 'slot_id', p_slot_id, 'reason', p_force_reason),
              CASE WHEN v_maintenance
                   THEN 'Force-booked a facility under maintenance'
                   ELSE 'Force-booked outside the facility weekly schedule' END,
              v_facility.name);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  BEGIN
    PERFORM public._notify_booking_event(v_booking_id, 'facility_slot_booked');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id, 'force_added', p_force,
                            'maintenance_override', v_maintenance,
                            'schedule_override', v_off_schedule,
                            'deduction', v_consume);
END;
$function$;

-- 2) Prune off-schedule future slots ----------------------------------------
CREATE OR REPLACE FUNCTION public.prune_off_schedule_slots(p_facility_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deactivated integer := 0;
  v_kept integer := 0;
BEGIN
  WITH candidates AS (
    SELECT s.id,
           EXISTS (
             SELECT 1 FROM public.benefit_bookings b
              WHERE b.slot_id = s.id AND b.status IN ('booked','confirmed','attended')
           ) AS has_bookings
      FROM public.benefit_slots s
      JOIN public.facilities f ON f.id = s.facility_id
     WHERE s.slot_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND s.is_active = true
       AND (p_facility_id IS NULL OR f.id = p_facility_id)
       AND NOT (
         lower(to_char(s.slot_date, 'Dy')) = ANY(
           COALESCE(f.available_days, ARRAY['mon','tue','wed','thu','fri','sat','sun'])
         )
       )
  ), killed AS (
    UPDATE public.benefit_slots s
       SET is_active = false, updated_at = now()
      FROM candidates c
     WHERE s.id = c.id AND c.has_bookings = false
     RETURNING s.id
  )
  SELECT (SELECT count(*) FROM killed),
         (SELECT count(*) FROM candidates WHERE has_bookings)
    INTO v_deactivated, v_kept;

  RETURN jsonb_build_object('success', true, 'deactivated', v_deactivated, 'kept_with_bookings', v_kept);
END;
$function$;

REVOKE ALL ON FUNCTION public.prune_off_schedule_slots(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_off_schedule_slots(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_facility_schedule_prune()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.available_days IS DISTINCT FROM OLD.available_days THEN
    PERFORM public.prune_off_schedule_slots(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_facility_schedule_prune ON public.facilities;
CREATE TRIGGER trg_facility_schedule_prune
AFTER UPDATE ON public.facilities
FOR EACH ROW EXECUTE FUNCTION public.tg_facility_schedule_prune();

-- one-off cleanup of the existing drift
SELECT public.prune_off_schedule_slots(NULL);

-- 3) Attendance marking ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_benefit_booking_attendance(
  p_booking_id uuid,
  p_state text,
  p_staff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_actor uuid := COALESCE(p_staff_id, auth.uid());
  v_now timestamptz := now();
  v_consume jsonb;
BEGIN
  IF p_state NOT IN ('attended','no_show','booked') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid state');
  END IF;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT (public.has_role(v_actor,'owner') OR public.has_role(v_actor,'admin')
          OR public.has_role(v_actor,'manager') OR public.has_role(v_actor,'staff')
          OR public.has_role(v_actor,'trainer')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not permitted');
  END IF;

  SELECT * INTO v_booking FROM public.benefit_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cancelled bookings cannot be marked');
  END IF;

  IF v_booking.status::text = p_state THEN
    RETURN jsonb_build_object('success', true, 'unchanged', true, 'status', p_state);
  END IF;

  UPDATE public.benefit_bookings
     SET status = p_state::public.benefit_booking_status,
         check_in_at = CASE WHEN p_state = 'attended' THEN COALESCE(check_in_at, v_now) ELSE NULL END,
         no_show_marked_at = CASE WHEN p_state = 'no_show' THEN v_now ELSE NULL END,
         updated_at = v_now
   WHERE id = p_booking_id;

  -- reversing a no-show may have refunded the session: re-reserve it
  IF v_booking.status = 'no_show' AND p_state <> 'no_show' THEN
    IF NOT EXISTS (SELECT 1 FROM public.benefit_usage WHERE booking_id = p_booking_id) THEN
      v_consume := public._consume_benefit_for_booking(p_booking_id, true);
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.booking_audit_log (booking_id, event_type, from_status, to_status, actor_id, metadata)
    VALUES (p_booking_id, 'attendance_marked', v_booking.status::text, p_state, v_actor,
            jsonb_build_object('marked_at', v_now));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'status', p_state, 'reconsumed', v_consume);
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_benefit_booking_attendance(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_benefit_booking_attendance(uuid, text, uuid) TO authenticated, service_role;