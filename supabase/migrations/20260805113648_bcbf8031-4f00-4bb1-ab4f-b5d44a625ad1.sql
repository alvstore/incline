-- 1. Link usage rows to bookings and remember where the session came from
ALTER TABLE public.benefit_usage
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.benefit_bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_meta jsonb;

CREATE INDEX IF NOT EXISTS idx_benefit_usage_booking ON public.benefit_usage(booking_id);

-- 2. Availability probe: -1 = unlimited, otherwise remaining units
CREATE OR REPLACE FUNCTION public.benefit_available_units(
  p_member_id uuid,
  p_membership_id uuid,
  p_benefit_type public.benefit_type,
  p_benefit_type_id uuid,
  p_date date DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_membership record;
  v_pb record;
  v_period_start date;
  v_used integer := 0;
  v_plan_remaining integer := 0;
  v_gift integer := 0;
  v_credit integer := 0;
BEGIN
  SELECT m.id, m.plan_id, m.start_date INTO v_membership
    FROM public.memberships m WHERE m.id = p_membership_id;

  IF FOUND THEN
    SELECT pb.frequency, pb.limit_count INTO v_pb
      FROM public.plan_benefits pb
     WHERE pb.plan_id = v_membership.plan_id
       AND (
         (p_benefit_type_id IS NOT NULL AND pb.benefit_type_id = p_benefit_type_id)
         OR (p_benefit_type_id IS NULL AND pb.benefit_type_id IS NULL AND pb.benefit_type = p_benefit_type)
       )
     LIMIT 1;

    IF FOUND THEN
      IF v_pb.frequency = 'unlimited' OR v_pb.limit_count IS NULL THEN
        RETURN -1;
      END IF;

      v_period_start := CASE v_pb.frequency
        WHEN 'daily' THEN v_date
        WHEN 'weekly' THEN (date_trunc('week', v_date::timestamp))::date
        WHEN 'monthly' THEN (date_trunc('month', v_date::timestamp))::date
        ELSE v_membership.start_date
      END;

      SELECT COALESCE(SUM(bu.usage_count), 0) INTO v_used
        FROM public.benefit_usage bu
       WHERE bu.membership_id = p_membership_id
         AND bu.usage_date >= v_period_start
         AND (
           (p_benefit_type_id IS NOT NULL AND bu.benefit_type_id = p_benefit_type_id)
           OR (p_benefit_type_id IS NULL AND bu.benefit_type = p_benefit_type)
         );

      v_plan_remaining := GREATEST(v_pb.limit_count - v_used, 0);
    END IF;
  END IF;

  IF p_benefit_type_id IS NOT NULL THEN
    SELECT COALESCE(SUM(GREATEST(mc.comp_sessions - mc.used_sessions, 0)), 0) INTO v_gift
      FROM public.member_comps mc
     WHERE mc.member_id = p_member_id
       AND mc.benefit_type_id = p_benefit_type_id
       AND mc.used_sessions < mc.comp_sessions
       AND (mc.expires_at IS NULL OR mc.expires_at > now());
  END IF;

  SELECT COALESCE(SUM(c.credits_remaining), 0) INTO v_credit
    FROM public.member_benefit_credits c
   WHERE c.member_id = p_member_id
     AND c.credits_remaining > 0
     AND c.expires_at > now()
     AND (
       (p_benefit_type_id IS NOT NULL AND c.benefit_type_id = p_benefit_type_id)
       OR (p_benefit_type_id IS NULL AND c.benefit_type = p_benefit_type)
     );

  RETURN v_plan_remaining + v_gift + v_credit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.benefit_available_units(uuid, uuid, public.benefit_type, uuid, date) TO authenticated, service_role;

-- 3. Consume one unit for a booking (plan -> gift -> purchased credit)
CREATE OR REPLACE FUNCTION public._consume_benefit_for_booking(p_booking_id uuid, p_allow_shortfall boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_slot record;
  v_type_id uuid;
  v_enum public.benefit_type;
  v_date date;
  v_avail integer;
  v_need integer := 1;
  v_from_plan integer := 0;
  v_gift_alloc jsonb := '[]'::jsonb;
  v_credit_alloc jsonb := '[]'::jsonb;
  v_take integer;
  r record;
BEGIN
  SELECT * INTO v_booking FROM public.benefit_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Booking not found'); END IF;

  IF EXISTS (SELECT 1 FROM public.benefit_usage WHERE booking_id = p_booking_id) THEN
    RETURN jsonb_build_object('success', true, 'already_consumed', true);
  END IF;

  SELECT * INTO v_slot FROM public.benefit_slots WHERE id = v_booking.slot_id;
  v_type_id := v_slot.benefit_type_id;
  v_enum := v_slot.benefit_type;
  IF v_type_id IS NOT NULL THEN
    SELECT public.safe_benefit_enum(bt.code)::public.benefit_type INTO v_enum
      FROM public.benefit_types bt WHERE bt.id = v_type_id;
  END IF;
  v_enum := COALESCE(v_enum, v_slot.benefit_type);
  v_date := v_slot.slot_date;

  v_avail := public.benefit_available_units(v_booking.member_id, v_booking.membership_id, v_enum, v_type_id, v_date);

  IF v_avail = 0 AND NOT p_allow_shortfall THEN
    RETURN jsonb_build_object('success', false, 'error', 'No sessions remaining for this benefit');
  END IF;

  IF v_avail = -1 THEN
    v_from_plan := 1;
    v_need := 0;
  ELSE
    -- plan allowance first
    IF public.benefit_plan_remaining(v_booking.membership_id, v_enum, v_type_id, v_date) > 0 THEN
      v_from_plan := 1;
      v_need := 0;
    END IF;

    IF v_need > 0 AND v_type_id IS NOT NULL THEN
      FOR r IN
        SELECT mc.id, (mc.comp_sessions - mc.used_sessions) AS avail
          FROM public.member_comps mc
         WHERE mc.member_id = v_booking.member_id
           AND mc.benefit_type_id = v_type_id
           AND mc.used_sessions < mc.comp_sessions
           AND (mc.expires_at IS NULL OR mc.expires_at > now())
         ORDER BY mc.expires_at NULLS LAST, mc.created_at
         FOR UPDATE
      LOOP
        EXIT WHEN v_need <= 0;
        v_take := LEAST(r.avail, v_need);
        UPDATE public.member_comps SET used_sessions = used_sessions + v_take, updated_at = now() WHERE id = r.id;
        v_gift_alloc := v_gift_alloc || jsonb_build_object('id', r.id, 'qty', v_take);
        v_need := v_need - v_take;
      END LOOP;
    END IF;

    IF v_need > 0 THEN
      FOR r IN
        SELECT c.id, c.credits_remaining AS avail
          FROM public.member_benefit_credits c
         WHERE c.member_id = v_booking.member_id
           AND c.credits_remaining > 0
           AND c.expires_at > now()
           AND (
             (v_type_id IS NOT NULL AND c.benefit_type_id = v_type_id)
             OR (v_type_id IS NULL AND c.benefit_type = v_enum)
           )
         ORDER BY c.expires_at, c.created_at
         FOR UPDATE
      LOOP
        EXIT WHEN v_need <= 0;
        v_take := LEAST(r.avail, v_need);
        UPDATE public.member_benefit_credits SET credits_remaining = credits_remaining - v_take, updated_at = now() WHERE id = r.id;
        v_credit_alloc := v_credit_alloc || jsonb_build_object('id', r.id, 'qty', v_take);
        v_need := v_need - v_take;
      END LOOP;
    END IF;

    IF v_need > 0 AND NOT p_allow_shortfall THEN
      RETURN jsonb_build_object('success', false, 'error', 'No sessions remaining for this benefit');
    END IF;
  END IF;

  INSERT INTO public.benefit_usage (
    membership_id, benefit_type, benefit_type_id, usage_date, usage_time,
    usage_count, notes, recorded_by, booking_id, source_meta
  ) VALUES (
    v_booking.membership_id, v_enum, v_type_id, v_date, v_slot.start_time,
    1, 'Auto-deducted on booking', v_booking.booked_by_staff_id, p_booking_id,
    jsonb_build_object(
      'from_plan', v_from_plan,
      'unlimited', (v_avail = -1),
      'gift', v_gift_alloc,
      'credit', v_credit_alloc,
      'shortfall', v_need
    )
  );

  RETURN jsonb_build_object('success', true, 'from_plan', v_from_plan,
    'gift', v_gift_alloc, 'credit', v_credit_alloc, 'shortfall', v_need);
END;
$$;

-- helper: remaining plan allowance only
CREATE OR REPLACE FUNCTION public.benefit_plan_remaining(
  p_membership_id uuid,
  p_benefit_type public.benefit_type,
  p_benefit_type_id uuid,
  p_date date
) RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership record;
  v_pb record;
  v_period_start date;
  v_used integer := 0;
BEGIN
  SELECT m.id, m.plan_id, m.start_date INTO v_membership
    FROM public.memberships m WHERE m.id = p_membership_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT pb.frequency, pb.limit_count INTO v_pb
    FROM public.plan_benefits pb
   WHERE pb.plan_id = v_membership.plan_id
     AND (
       (p_benefit_type_id IS NOT NULL AND pb.benefit_type_id = p_benefit_type_id)
       OR (p_benefit_type_id IS NULL AND pb.benefit_type_id IS NULL AND pb.benefit_type = p_benefit_type)
     )
   LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF v_pb.frequency = 'unlimited' OR v_pb.limit_count IS NULL THEN RETURN 999999; END IF;

  v_period_start := CASE v_pb.frequency
    WHEN 'daily' THEN p_date
    WHEN 'weekly' THEN (date_trunc('week', p_date::timestamp))::date
    WHEN 'monthly' THEN (date_trunc('month', p_date::timestamp))::date
    ELSE v_membership.start_date
  END;

  SELECT COALESCE(SUM(bu.usage_count), 0) INTO v_used
    FROM public.benefit_usage bu
   WHERE bu.membership_id = p_membership_id
     AND bu.usage_date >= v_period_start
     AND (
       (p_benefit_type_id IS NOT NULL AND bu.benefit_type_id = p_benefit_type_id)
       OR (p_benefit_type_id IS NULL AND bu.benefit_type = p_benefit_type)
     );

  RETURN GREATEST(v_pb.limit_count - v_used, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.benefit_plan_remaining(uuid, public.benefit_type, uuid, date) TO authenticated, service_role;

-- 4. Give the session back
CREATE OR REPLACE FUNCTION public._release_benefit_for_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage record;
  v_alloc jsonb;
  v_released integer := 0;
BEGIN
  FOR v_usage IN SELECT * FROM public.benefit_usage WHERE booking_id = p_booking_id LOOP
    FOR v_alloc IN SELECT jsonb_array_elements(COALESCE(v_usage.source_meta->'gift', '[]'::jsonb)) LOOP
      UPDATE public.member_comps
         SET used_sessions = GREATEST(used_sessions - (v_alloc->>'qty')::int, 0), updated_at = now()
       WHERE id = (v_alloc->>'id')::uuid;
    END LOOP;

    FOR v_alloc IN SELECT jsonb_array_elements(COALESCE(v_usage.source_meta->'credit', '[]'::jsonb)) LOOP
      UPDATE public.member_benefit_credits
         SET credits_remaining = credits_remaining + (v_alloc->>'qty')::int, updated_at = now()
       WHERE id = (v_alloc->>'id')::uuid;
    END LOOP;

    DELETE FROM public.benefit_usage WHERE id = v_usage.id;
    v_released := v_released + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'released', v_released);
END;
$$;

-- 5. Booking now deducts
CREATE OR REPLACE FUNCTION public.book_facility_slot(
  p_slot_id uuid,
  p_member_id uuid,
  p_membership_id uuid,
  p_source text DEFAULT 'member_portal',
  p_staff_id uuid DEFAULT NULL,
  p_force boolean DEFAULT false,
  p_force_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF v_maintenance THEN
    BEGIN
      INSERT INTO booking_audit_log (booking_id, event_type, to_status, actor_id, reason, metadata)
      VALUES (v_booking_id, 'maintenance_override', 'booked', p_staff_id, p_force_reason,
              jsonb_build_object('facility_id', v_facility.id, 'facility_name', v_facility.name, 'slot_id', p_slot_id));

      INSERT INTO audit_logs (branch_id, user_id, action, table_name, record_id, new_data, action_description, target_name)
      VALUES (v_slot.branch_id, p_staff_id, 'maintenance_override', 'benefit_bookings', v_booking_id,
              jsonb_build_object('facility_id', v_facility.id, 'slot_id', p_slot_id, 'reason', p_force_reason),
              'Force-booked a facility under maintenance', v_facility.name);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  BEGIN
    PERFORM public._notify_booking_event(v_booking_id, 'facility_slot_booked');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id, 'force_added', p_force,
                            'maintenance_override', v_maintenance,
                            'deduction', v_consume);
END;
$$;

-- 6. Cancellation returns the session
CREATE OR REPLACE FUNCTION public.cancel_facility_slot(
  p_booking_id uuid,
  p_reason text DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_override_deadline boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD; v_slot RECORD; v_settings RECORD;
  v_slot_dt timestamptz; v_deadline_minutes integer;
  v_is_privileged boolean := false;
  v_waiter RECORD; v_promoted_booking_id uuid; v_promoted boolean := false;
  v_release jsonb := NULL;
BEGIN
  SELECT * INTO v_booking FROM public.benefit_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Booking not found'); END IF;
  IF v_booking.status = 'cancelled' THEN RETURN jsonb_build_object('success', false, 'error', 'Already cancelled'); END IF;

  IF p_override_deadline THEN
    IF p_staff_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Override requires staff identity'); END IF;
    SELECT (public.has_role(p_staff_id,'admin') OR public.has_role(p_staff_id,'owner') OR public.has_role(p_staff_id,'manager'))
      INTO v_is_privileged;
    IF NOT v_is_privileged THEN RETURN jsonb_build_object('success', false, 'error', 'Only admin/owner/manager can override'); END IF;
  END IF;

  SELECT * INTO v_slot FROM public.benefit_slots WHERE id = v_booking.slot_id FOR UPDATE;

  SELECT * INTO v_settings FROM public.benefit_settings
    WHERE branch_id = v_slot.branch_id
      AND (
        (v_slot.benefit_type_id IS NOT NULL AND benefit_type_id = v_slot.benefit_type_id)
        OR (v_slot.benefit_type_id IS NULL AND benefit_type = v_slot.benefit_type)
      )
    LIMIT 1;

  IF NOT p_override_deadline THEN
    v_deadline_minutes := COALESCE(v_settings.cancellation_deadline_minutes, 60);
    v_slot_dt := (v_slot.slot_date::timestamp + v_slot.start_time) AT TIME ZONE 'Asia/Kolkata';
    IF now() > v_slot_dt - (v_deadline_minutes || ' minutes')::interval THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('Cancellation deadline is %s minutes before slot', v_deadline_minutes));
    END IF;
  END IF;

  UPDATE public.benefit_bookings SET
    status = 'cancelled', cancelled_at = now(),
    cancellation_reason = p_reason, cancelled_by_staff_id = p_staff_id
  WHERE id = p_booking_id;

  UPDATE public.benefit_slots SET booked_count = GREATEST(booked_count - 1, 0)
    WHERE id = v_booking.slot_id;

  -- refund the reserved session (in-window cancellations and staff overrides)
  v_release := public._release_benefit_for_booking(p_booking_id);

  SELECT w.* INTO v_waiter
    FROM public.benefit_slot_waitlist w
   WHERE w.slot_id = v_booking.slot_id AND w.status = 'waiting'
   ORDER BY w.position ASC, w.joined_at ASC
   FOR UPDATE SKIP LOCKED LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.benefit_bookings (
      slot_id, member_id, membership_id, status, source, booked_by_staff_id
    ) VALUES (
      v_booking.slot_id, v_waiter.member_id, v_booking.membership_id, 'booked', 'system', NULL
    ) RETURNING id INTO v_promoted_booking_id;

    UPDATE public.benefit_slots SET booked_count = booked_count + 1 WHERE id = v_booking.slot_id;
    PERFORM public._consume_benefit_for_booking(v_promoted_booking_id, true);

    UPDATE public.benefit_slot_waitlist
       SET status = 'promoted', promoted_at = now(),
           promoted_booking_id = v_promoted_booking_id, notified_at = now()
     WHERE id = v_waiter.id;

    INSERT INTO public.notifications (user_id, branch_id, title, message, type, category, action_url, metadata)
    SELECT m.user_id, v_slot.branch_id,
           'Slot available!',
           format('A spot opened up — you''ve been booked into your %s slot.', v_slot.benefit_type),
           'success', 'waitlist_promotion', '/my-benefits',
           jsonb_build_object('booking_id', v_promoted_booking_id, 'slot_id', v_booking.slot_id)
      FROM public.members m WHERE m.id = v_waiter.member_id AND m.user_id IS NOT NULL;
    v_promoted := true;
  END IF;

  BEGIN PERFORM public._notify_booking_event(p_booking_id, 'facility_slot_cancelled');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success', true, 'overridden', p_override_deadline,
    'waitlist_promoted', v_promoted, 'promoted_booking_id', v_promoted_booking_id,
    'refund', v_release
  );
END;
$$;

-- 7. No-show handling per branch policy
CREATE OR REPLACE FUNCTION public.tg_benefit_booking_no_show_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot record;
  v_policy public.no_show_policy;
BEGIN
  IF NEW.status = 'no_show' AND OLD.status IS DISTINCT FROM 'no_show' THEN
    SELECT * INTO v_slot FROM public.benefit_slots WHERE id = NEW.slot_id;
    SELECT no_show_policy INTO v_policy FROM public.benefit_settings
      WHERE branch_id = v_slot.branch_id
        AND (
          (v_slot.benefit_type_id IS NOT NULL AND benefit_type_id = v_slot.benefit_type_id)
          OR (v_slot.benefit_type_id IS NULL AND benefit_type = v_slot.benefit_type)
        )
      LIMIT 1;
    IF COALESCE(v_policy, 'mark_used') = 'allow_reschedule' THEN
      PERFORM public._release_benefit_for_booking(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_benefit_booking_no_show_release ON public.benefit_bookings;
CREATE TRIGGER trg_benefit_booking_no_show_release
AFTER UPDATE OF status ON public.benefit_bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_benefit_booking_no_show_release();

-- 8. Slot generation writes the real benefit enum
CREATE OR REPLACE FUNCTION public.ensure_facility_slots(
  p_branch_id uuid,
  p_start_date date,
  p_end_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    v_safe_bt := COALESCE(
      NULLIF(public.safe_benefit_enum(v_facility.bt_code), 'other'),
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
$$;

-- 9. Correct existing mislabelled slots
UPDATE public.benefit_slots s
   SET benefit_type = public.safe_benefit_enum(bt.code)::public.benefit_type
  FROM public.benefit_types bt
 WHERE bt.id = s.benefit_type_id
   AND s.benefit_type = 'other'
   AND public.safe_benefit_enum(bt.code) <> 'other';

-- 10. Record notification dispatch attempts instead of dropping them silently
CREATE OR REPLACE FUNCTION public._notify_booking_event(p_booking_id uuid, p_event text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/notify-booking-event';
  v_anon TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo';
  v_req_id bigint;
BEGIN
  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
    body := jsonb_build_object('event', p_event, 'booking_id', p_booking_id)
  ) INTO v_req_id;

  BEGIN
    INSERT INTO public.booking_audit_log (booking_id, event_type, reason, metadata)
    VALUES (p_booking_id, 'notification_dispatched', p_event,
            jsonb_build_object('net_request_id', v_req_id, 'event', p_event, 'at', now()));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM public.log_error_event(
      'notify_booking_event_failed',
      SQLERRM,
      'error',
      'booking_notifications',
      jsonb_build_object('booking_id', p_booking_id, 'event', p_event)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END;
$$;

-- 11. Backfill the existing booking that was never deducted
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT bb.id FROM public.benefit_bookings bb
     WHERE bb.status IN ('booked','confirmed','attended')
       AND NOT EXISTS (SELECT 1 FROM public.benefit_usage bu WHERE bu.booking_id = bb.id)
  LOOP
    PERFORM public._consume_benefit_for_booking(r.id, true);
  END LOOP;
END $$;