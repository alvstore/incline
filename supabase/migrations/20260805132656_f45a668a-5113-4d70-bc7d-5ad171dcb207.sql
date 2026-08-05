-- 1. Prep lead time on facilities
ALTER TABLE public.facilities
  ADD COLUMN IF NOT EXISTS prep_lead_minutes integer NOT NULL DEFAULT 0;

UPDATE public.facilities f
SET prep_lead_minutes = 480
FROM public.benefit_types bt
WHERE bt.id = f.benefit_type_id
  AND f.prep_lead_minutes = 0
  AND (lower(bt.code) LIKE '%ice%bath%' OR lower(bt.name) LIKE '%ice bath%' OR lower(f.name) LIKE '%ice bath%');

-- 2. Fix ensure_facility_slots COALESCE type mismatch
CREATE OR REPLACE FUNCTION public.ensure_facility_slots(p_branch_id uuid, p_start_date date, p_end_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_facility RECORD;
  v_settings RECORD;
  v_current_date DATE;
  v_day_abbr TEXT;
  v_start_time TIME;
  v_end_time TIME;
  v_duration INT;
  v_buffer INT;
  v_capacity INT;
  v_slot_start TIME;
  v_slot_end TIME;
  v_safe_bt TEXT;
BEGIN
  FOR v_facility IN
    SELECT f.id, f.benefit_type_id, f.capacity AS fac_capacity,
           COALESCE(f.available_days, ARRAY['mon','tue','wed','thu','fri','sat','sun']) AS available_days,
           bt.code AS bt_code
    FROM facilities f
    LEFT JOIN benefit_types bt ON bt.id = f.benefit_type_id
    WHERE f.branch_id = p_branch_id
      AND f.is_active = true
      AND COALESCE(f.under_maintenance, false) = false
  LOOP
    SELECT bs.operating_hours_start, bs.operating_hours_end,
           bs.slot_duration_minutes, bs.buffer_between_sessions_minutes,
           bs.capacity_per_slot, bs.is_slot_booking_enabled,
           bs.benefit_type
    INTO v_settings
    FROM benefit_settings bs
    WHERE bs.branch_id = p_branch_id
      AND bs.benefit_type_id = v_facility.benefit_type_id
    LIMIT 1;

    IF v_settings IS NOT NULL AND v_settings.is_slot_booking_enabled = false THEN
      CONTINUE;
    END IF;

    v_start_time := COALESCE(v_settings.operating_hours_start, '06:00:00')::TIME;
    v_end_time := COALESCE(v_settings.operating_hours_end, '22:00:00')::TIME;
    v_duration := COALESCE(v_settings.slot_duration_minutes, 30);
    v_buffer := COALESCE(v_settings.buffer_between_sessions_minutes, 0);
    v_capacity := COALESCE(v_facility.fac_capacity, v_settings.capacity_per_slot, 1);

    -- prefer the benefit type's own code; settings enum is only a fallback
    -- (all branches cast to TEXT so COALESCE has a single resolvable type)
    v_safe_bt := COALESCE(
      NULLIF(public.safe_benefit_enum(v_facility.bt_code)::TEXT, 'other'),
      NULLIF(v_settings.benefit_type::TEXT, 'other'),
      'other'
    );

    v_current_date := p_start_date;
    WHILE v_current_date <= p_end_date LOOP
      v_day_abbr := LOWER(LEFT(TO_CHAR(v_current_date, 'Dy'), 3));

      IF v_day_abbr = ANY(v_facility.available_days) THEN
        IF NOT EXISTS (
          SELECT 1 FROM benefit_slots
          WHERE facility_id = v_facility.id
            AND slot_date = v_current_date
            AND is_active = true
        ) THEN
          v_slot_start := v_start_time;
          WHILE v_slot_start + (v_duration || ' minutes')::INTERVAL <= v_end_time LOOP
            v_slot_end := v_slot_start + (v_duration || ' minutes')::INTERVAL;

            INSERT INTO benefit_slots (
              branch_id, benefit_type, benefit_type_id, facility_id,
              slot_date, start_time, end_time, capacity, is_active
            ) VALUES (
              p_branch_id,
              v_safe_bt::benefit_type,
              v_facility.benefit_type_id,
              v_facility.id,
              v_current_date,
              v_slot_start,
              v_slot_end,
              v_capacity,
              true
            );

            v_slot_start := v_slot_end + (v_buffer || ' minutes')::INTERVAL;
          END LOOP;
        END IF;
      END IF;

      v_current_date := v_current_date + 1;
    END LOOP;
  END LOOP;
END;
$function$;

-- 3. New approval type
ALTER TYPE public.approval_type ADD VALUE IF NOT EXISTS 'booking_reschedule';

-- 4. Request a reschedule (maker)
CREATE OR REPLACE FUNCTION public.request_booking_reschedule(
  p_booking_id uuid,
  p_new_slot_id uuid,
  p_reason text,
  p_blame text DEFAULT 'gym',
  p_restore_credit boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_branch_id uuid;
  v_new_slot RECORD;
  v_request_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT b.*, s.branch_id AS slot_branch_id, s.slot_date, s.start_time
  INTO v_booking
  FROM benefit_bookings b
  JOIN benefit_slots s ON s.id = b.slot_id
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF v_booking.status NOT IN ('booked', 'confirmed') THEN
    RAISE EXCEPTION 'Only active bookings can be rescheduled (current status: %)', v_booking.status;
  END IF;

  v_branch_id := v_booking.slot_branch_id;

  IF NOT (
    has_any_role(v_uid, ARRAY['owner'::app_role, 'admin'::app_role])
    OR v_branch_id IN (SELECT user_visible_branch_ids(v_uid))
  ) THEN
    RAISE EXCEPTION 'Not permitted for this branch';
  END IF;

  IF p_restore_credit IS NOT TRUE THEN
    IF p_new_slot_id IS NULL THEN
      RAISE EXCEPTION 'Pick a new slot or choose to return the session credit';
    END IF;

    SELECT s.*, COALESCE(f.under_maintenance, false) AS maint
    INTO v_new_slot
    FROM benefit_slots s
    LEFT JOIN facilities f ON f.id = s.facility_id
    WHERE s.id = p_new_slot_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'New slot not found';
    END IF;
    IF v_new_slot.is_active = false OR v_new_slot.maint THEN
      RAISE EXCEPTION 'That slot is unavailable (facility under maintenance)';
    END IF;
    IF v_new_slot.booked_count >= v_new_slot.capacity THEN
      RAISE EXCEPTION 'That slot is already full';
    END IF;
    IF v_new_slot.branch_id <> v_branch_id THEN
      RAISE EXCEPTION 'New slot belongs to a different branch';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM approval_requests
    WHERE approval_type = 'booking_reschedule'
      AND reference_id = p_booking_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A reschedule request is already pending for this booking';
  END IF;

  INSERT INTO approval_requests (
    branch_id, approval_type, reference_type, reference_id, requested_by, request_data
  ) VALUES (
    v_branch_id,
    'booking_reschedule',
    'benefit_booking',
    p_booking_id,
    v_uid,
    jsonb_build_object(
      'booking_id', p_booking_id,
      'member_id', v_booking.member_id,
      'old_slot_id', v_booking.slot_id,
      'new_slot_id', p_new_slot_id,
      'reason', p_reason,
      'blame', COALESCE(p_blame, 'gym'),
      'restore_credit', COALESCE(p_restore_credit, false)
    )
  )
  RETURNING id INTO v_request_id;

  INSERT INTO booking_audit_log (booking_id, event_type, from_status, to_status, actor_id, reason, metadata)
  VALUES (
    p_booking_id, 'reschedule_requested', v_booking.status::text, v_booking.status::text, v_uid, p_reason,
    jsonb_build_object('request_id', v_request_id, 'new_slot_id', p_new_slot_id, 'blame', p_blame, 'restore_credit', p_restore_credit)
  );

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'status', 'pending');
END;
$function$;

GRANT EXECUTE ON FUNCTION public.request_booking_reschedule(uuid, uuid, text, text, boolean) TO authenticated;

-- 5. Decide a reschedule (checker)
CREATE OR REPLACE FUNCTION public.decide_booking_reschedule(
  p_request_id uuid,
  p_approve boolean,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req RECORD;
  v_booking RECORD;
  v_new_slot RECORD;
  v_uid uuid := auth.uid();
  v_restore boolean;
  v_new_slot_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_req FROM approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approval request not found';
  END IF;
  IF v_req.approval_type <> 'booking_reschedule' THEN
    RAISE EXCEPTION 'Not a booking reschedule request';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request already %', v_req.status;
  END IF;

  IF NOT (
    has_any_role(v_uid, ARRAY['owner'::app_role, 'admin'::app_role])
    OR manages_branch(v_uid, v_req.branch_id)
  ) THEN
    RAISE EXCEPTION 'Only owners, admins or the branch manager can decide this request';
  END IF;

  IF NOT p_approve THEN
    UPDATE approval_requests
    SET status = 'rejected', reviewed_by = v_uid, reviewed_at = now(), review_notes = p_notes
    WHERE id = p_request_id;

    INSERT INTO booking_audit_log (booking_id, event_type, actor_id, reason, metadata)
    VALUES (v_req.reference_id, 'reschedule_rejected', v_uid, p_notes, jsonb_build_object('request_id', p_request_id));

    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  v_restore := COALESCE((v_req.request_data->>'restore_credit')::boolean, false);
  v_new_slot_id := NULLIF(v_req.request_data->>'new_slot_id', '')::uuid;

  SELECT * INTO v_booking FROM benefit_bookings WHERE id = v_req.reference_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking no longer exists';
  END IF;
  IF v_booking.status NOT IN ('booked', 'confirmed') THEN
    RAISE EXCEPTION 'Booking is no longer active (%).', v_booking.status;
  END IF;

  IF v_restore THEN
    -- Gym-fault cancellation: return the consumed session to the member.
    PERFORM public._release_benefit_for_booking(v_booking.id);

    UPDATE benefit_bookings
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by_staff_id = v_uid,
        cancellation_reason = COALESCE(v_req.request_data->>'reason', 'Rescheduled — credit returned')
    WHERE id = v_booking.id;

    INSERT INTO booking_audit_log (booking_id, event_type, from_status, to_status, actor_id, reason, metadata)
    VALUES (v_booking.id, 'reschedule_credit_restored', v_booking.status::text, 'cancelled', v_uid,
            v_req.request_data->>'reason', jsonb_build_object('request_id', p_request_id));

    PERFORM public._notify_booking_event(v_booking.id, 'facility_cancelled');
  ELSE
    SELECT s.*, COALESCE(f.under_maintenance, false) AS maint
    INTO v_new_slot
    FROM benefit_slots s
    LEFT JOIN facilities f ON f.id = s.facility_id
    WHERE s.id = v_new_slot_id
    FOR UPDATE OF s;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target slot no longer exists';
    END IF;
    IF v_new_slot.is_active = false OR v_new_slot.maint THEN
      RAISE EXCEPTION 'Target slot is unavailable (facility under maintenance)';
    END IF;
    IF v_new_slot.booked_count >= v_new_slot.capacity THEN
      RAISE EXCEPTION 'Target slot is now full — ask staff to pick another time';
    END IF;

    -- Move the booking. The booked_count trigger does not react to slot_id
    -- changes, so adjust both slots explicitly. No credit movement: the
    -- session was already consumed at original booking time.
    UPDATE benefit_bookings
    SET slot_id = v_new_slot_id,
        notes = COALESCE(notes || E'\n', '') || 'Rescheduled: ' || COALESCE(v_req.request_data->>'reason', '')
    WHERE id = v_booking.id;

    UPDATE benefit_slots SET booked_count = GREATEST(0, booked_count - 1) WHERE id = v_booking.slot_id;
    UPDATE benefit_slots SET booked_count = booked_count + 1 WHERE id = v_new_slot_id;

    INSERT INTO booking_audit_log (booking_id, event_type, from_status, to_status, actor_id, reason, metadata)
    VALUES (v_booking.id, 'rescheduled', v_booking.status::text, v_booking.status::text, v_uid,
            v_req.request_data->>'reason',
            jsonb_build_object('request_id', p_request_id, 'old_slot_id', v_booking.slot_id, 'new_slot_id', v_new_slot_id));

    PERFORM public._notify_booking_event(v_booking.id, 'facility_booked');
  END IF;

  UPDATE approval_requests
  SET status = 'approved', reviewed_by = v_uid, reviewed_at = now(),
      review_notes = p_notes, side_effects_committed_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true, 'status', 'approved', 'credit_restored', v_restore);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.decide_booking_reschedule(uuid, boolean, text) TO authenticated;