-- 1. usage_time column
ALTER TABLE public.benefit_usage ADD COLUMN IF NOT EXISTS usage_time time;

-- 2. record_benefit_usage with backdating
DROP FUNCTION IF EXISTS public.record_benefit_usage(uuid, uuid, benefit_type, uuid, integer, text);

CREATE OR REPLACE FUNCTION public.record_benefit_usage(
  p_membership_id uuid,
  p_member_id uuid,
  p_benefit_type public.benefit_type,
  p_benefit_type_id uuid DEFAULT NULL,
  p_usage_count integer DEFAULT 1,
  p_notes text DEFAULT NULL,
  p_usage_date date DEFAULT NULL,
  p_usage_time time DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_membership record;
  v_pb record;
  v_date date := COALESCE(p_usage_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_period_start date;
  v_used integer := 0;
  v_plan_remaining integer := 0;
  v_plan_unlimited boolean := false;
  v_need integer := GREATEST(COALESCE(p_usage_count, 1), 1);
  v_from_plan integer := 0;
  v_from_gift integer := 0;
  v_from_credit integer := 0;
  v_gift_avail integer := 0;
  v_credit_avail integer := 0;
  v_take integer;
  r record;
  v_sources text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.has_role(v_uid, 'owner') OR public.has_role(v_uid, 'admin') OR
    public.has_role(v_uid, 'manager') OR public.has_role(v_uid, 'staff') OR
    public.has_role(v_uid, 'trainer')
  ) THEN
    RAISE EXCEPTION 'Not authorised to record benefit usage';
  END IF;

  SELECT m.id, m.member_id, m.plan_id, m.start_date, m.end_date
    INTO v_membership
  FROM public.memberships m
  WHERE m.id = p_membership_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membership not found');
  END IF;

  IF v_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usage date cannot be in the future');
  END IF;

  IF v_date < v_membership.start_date THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Usage date cannot be before the membership start date (%s)', v_membership.start_date));
  END IF;

  IF v_membership.end_date IS NOT NULL AND v_date > v_membership.end_date THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('Usage date cannot be after the membership end date (%s)', v_membership.end_date));
  END IF;

  -- ---------- 1. Plan allowance (relative to chosen date) ----------
  SELECT pb.frequency, pb.limit_count
    INTO v_pb
  FROM public.plan_benefits pb
  WHERE pb.plan_id = v_membership.plan_id
    AND (
      (p_benefit_type_id IS NOT NULL AND pb.benefit_type_id = p_benefit_type_id)
      OR (p_benefit_type_id IS NULL AND pb.benefit_type_id IS NULL AND pb.benefit_type = p_benefit_type)
    )
  LIMIT 1;

  IF FOUND THEN
    IF v_pb.frequency = 'unlimited' OR v_pb.limit_count IS NULL THEN
      v_plan_unlimited := true;
    ELSE
      v_period_start := CASE v_pb.frequency
        WHEN 'daily' THEN v_date
        WHEN 'weekly' THEN (date_trunc('week', v_date::timestamp))::date
        WHEN 'monthly' THEN (date_trunc('month', v_date::timestamp))::date
        ELSE v_membership.start_date
      END;

      SELECT COALESCE(SUM(bu.usage_count), 0)
        INTO v_used
      FROM public.benefit_usage bu
      WHERE bu.membership_id = p_membership_id
        AND bu.usage_date >= v_period_start
        AND (
          v_pb.frequency NOT IN ('daily','weekly','monthly')
          OR bu.usage_date <= (CASE v_pb.frequency
                WHEN 'daily' THEN v_date
                WHEN 'weekly' THEN v_period_start + 6
                ELSE (v_period_start + interval '1 month' - interval '1 day')::date
              END)
        )
        AND (
          (p_benefit_type_id IS NOT NULL AND bu.benefit_type_id = p_benefit_type_id)
          OR (p_benefit_type_id IS NULL AND bu.benefit_type = p_benefit_type)
        );

      v_plan_remaining := GREATEST(v_pb.limit_count - v_used, 0);
    END IF;
  END IF;

  IF v_plan_unlimited THEN
    v_from_plan := v_need;
    v_need := 0;
    v_sources := v_sources || 'plan';
  ELSIF v_plan_remaining > 0 THEN
    v_take := LEAST(v_plan_remaining, v_need);
    v_from_plan := v_take;
    v_need := v_need - v_take;
    v_sources := v_sources || 'plan';
  END IF;

  -- ---------- 2. Complimentary gifts ----------
  IF v_need > 0 AND p_benefit_type_id IS NOT NULL THEN
    SELECT COALESCE(SUM(GREATEST(mc.comp_sessions - mc.used_sessions, 0)), 0)
      INTO v_gift_avail
    FROM public.member_comps mc
    WHERE mc.member_id = p_member_id
      AND mc.benefit_type_id = p_benefit_type_id
      AND mc.used_sessions < mc.comp_sessions
      AND (mc.expires_at IS NULL OR mc.expires_at > now());
  END IF;

  -- ---------- 3. Purchased credits ----------
  IF v_need - LEAST(v_gift_avail, v_need) > 0 THEN
    SELECT COALESCE(SUM(c.credits_remaining), 0)
      INTO v_credit_avail
    FROM public.member_benefit_credits c
    WHERE c.member_id = p_member_id
      AND c.credits_remaining > 0
      AND c.expires_at > now()
      AND (
        (p_benefit_type_id IS NOT NULL AND c.benefit_type_id = p_benefit_type_id)
        OR (p_benefit_type_id IS NULL AND c.benefit_type = p_benefit_type)
      );
  END IF;

  IF v_need > v_gift_avail + v_credit_avail THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No sessions remaining for this benefit',
      'plan_remaining', v_plan_remaining,
      'gift_remaining', v_gift_avail,
      'credit_remaining', v_credit_avail
    );
  END IF;

  IF v_need > 0 AND p_benefit_type_id IS NOT NULL THEN
    FOR r IN
      SELECT mc.id, (mc.comp_sessions - mc.used_sessions) AS avail
      FROM public.member_comps mc
      WHERE mc.member_id = p_member_id
        AND mc.benefit_type_id = p_benefit_type_id
        AND mc.used_sessions < mc.comp_sessions
        AND (mc.expires_at IS NULL OR mc.expires_at > now())
      ORDER BY mc.expires_at NULLS LAST, mc.created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(r.avail, v_need);
      UPDATE public.member_comps
         SET used_sessions = used_sessions + v_take,
             updated_at = now()
       WHERE id = r.id;
      v_from_gift := v_from_gift + v_take;
      v_need := v_need - v_take;
    END LOOP;
    IF v_from_gift > 0 THEN
      v_sources := v_sources || 'gift';
    END IF;
  END IF;

  IF v_need > 0 THEN
    FOR r IN
      SELECT c.id, c.credits_remaining AS avail
      FROM public.member_benefit_credits c
      WHERE c.member_id = p_member_id
        AND c.credits_remaining > 0
        AND c.expires_at > now()
        AND (
          (p_benefit_type_id IS NOT NULL AND c.benefit_type_id = p_benefit_type_id)
          OR (p_benefit_type_id IS NULL AND c.benefit_type = p_benefit_type)
        )
      ORDER BY c.expires_at, c.created_at
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(r.avail, v_need);
      UPDATE public.member_benefit_credits
         SET credits_remaining = credits_remaining - v_take,
             updated_at = now()
       WHERE id = r.id;
      v_from_credit := v_from_credit + v_take;
      v_need := v_need - v_take;
    END LOOP;
    IF v_from_credit > 0 THEN
      v_sources := v_sources || 'purchased';
    END IF;
  END IF;

  IF v_need > 0 THEN
    RAISE EXCEPTION 'Insufficient benefit entitlement';
  END IF;

  INSERT INTO public.benefit_usage (
    membership_id, benefit_type, benefit_type_id, usage_date, usage_time, usage_count, notes, recorded_by
  ) VALUES (
    p_membership_id,
    public.safe_benefit_enum(p_benefit_type::text)::public.benefit_type,
    p_benefit_type_id,
    v_date,
    p_usage_time,
    GREATEST(COALESCE(p_usage_count, 1), 1),
    NULLIF(p_notes, ''),
    v_uid
  );

  RETURN jsonb_build_object(
    'success', true,
    'usage_date', v_date,
    'sources', to_jsonb(v_sources),
    'from_plan', v_from_plan,
    'from_gift', v_from_gift,
    'from_credit', v_from_credit,
    'plan_remaining', CASE WHEN v_plan_unlimited THEN NULL ELSE GREATEST(v_plan_remaining - v_from_plan, 0) END,
    'gift_remaining', GREATEST(v_gift_avail - v_from_gift, 0),
    'credit_remaining', GREATEST(v_credit_avail - v_from_credit, 0)
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.record_benefit_usage(uuid, uuid, public.benefit_type, uuid, integer, text, date, time) TO authenticated;

-- 3. book_facility_slot with maintenance enforcement
CREATE OR REPLACE FUNCTION public.book_facility_slot(
  p_slot_id uuid,
  p_member_id uuid,
  p_membership_id uuid,
  p_staff_id uuid DEFAULT NULL,
  p_source text DEFAULT 'member_portal',
  p_force boolean DEFAULT false,
  p_force_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  -- Maintenance / inactive facility guard
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

  IF NOT p_force THEN
    SELECT * INTO v_settings
      FROM benefit_settings
      WHERE branch_id = v_slot.branch_id
        AND benefit_type = v_slot.benefit_type
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
          AND bs.benefit_type = v_slot.benefit_type
          AND bs.slot_date = v_slot.slot_date
          AND bb.status IN ('booked','attended');
      IF v_today_count >= v_settings.max_bookings_per_day THEN
        RETURN jsonb_build_object('success', false, 'error', 'Daily booking limit reached');
      END IF;
    END IF;

    IF v_facility.id IS NOT NULL AND v_facility.gender_access IS NOT NULL AND v_facility.gender_access <> 'unisex' THEN
      SELECT lower(gender::text) INTO v_member_gender FROM members WHERE id = p_member_id;
      IF v_member_gender IS NOT NULL AND v_member_gender <> lower(v_facility.gender_access) THEN
        RETURN jsonb_build_object('success', false, 'error',
          format('This facility is %s-only', v_facility.gender_access));
      END IF;
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

  -- Audit maintenance override
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
                            'maintenance_override', v_maintenance);
END;
$fn$;

-- 4. Slot hygiene trigger on maintenance toggle
CREATE OR REPLACE FUNCTION public.tg_facility_maintenance_sync_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF COALESCE(NEW.under_maintenance, false) IS DISTINCT FROM COALESCE(OLD.under_maintenance, false)
     OR COALESCE(NEW.is_active, true) IS DISTINCT FROM COALESCE(OLD.is_active, true) THEN
    IF COALESCE(NEW.under_maintenance, false) = true OR COALESCE(NEW.is_active, true) = false THEN
      UPDATE benefit_slots
         SET is_active = false, updated_at = now()
       WHERE facility_id = NEW.id
         AND slot_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
         AND is_active = true;
    ELSE
      UPDATE benefit_slots
         SET is_active = true, updated_at = now()
       WHERE facility_id = NEW.id
         AND slot_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
         AND is_active = false;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_facility_maintenance_sync_slots ON public.facilities;
CREATE TRIGGER trg_facility_maintenance_sync_slots
AFTER UPDATE ON public.facilities
FOR EACH ROW EXECUTE FUNCTION public.tg_facility_maintenance_sync_slots();

-- 5. One-off cleanup for facilities already under maintenance
UPDATE public.benefit_slots s
   SET is_active = false, updated_at = now()
  FROM public.facilities f
 WHERE s.facility_id = f.id
   AND (COALESCE(f.under_maintenance, false) = true OR COALESCE(f.is_active, true) = false)
   AND s.slot_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND s.is_active = true;