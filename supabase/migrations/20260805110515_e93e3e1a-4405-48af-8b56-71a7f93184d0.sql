
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS hardware_access_reason text;

-- 1. Fix gender lookup: gender lives on profiles, not members
CREATE OR REPLACE FUNCTION public.book_facility_slot(
  p_slot_id uuid,
  p_member_id uuid,
  p_membership_id uuid,
  p_staff_id uuid DEFAULT NULL::uuid,
  p_source text DEFAULT 'member_portal'::text,
  p_force boolean DEFAULT false,
  p_force_reason text DEFAULT NULL::text
) RETURNS jsonb
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
      -- gender lives on profiles (members has no gender column)
      SELECT lower(p.gender::text) INTO v_member_gender
        FROM members m
        LEFT JOIN profiles p ON p.id = m.user_id
       WHERE m.id = p_member_id;
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

-- 2. Members whose dues-revoke can now be lifted
CREATE OR REPLACE FUNCTION public.members_restorable_after_dues()
RETURNS TABLE(member_id uuid, member_code text, branch_id uuid, mips_person_sn text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT m.id, m.member_code, m.branch_id, m.mips_person_sn
  FROM public.members m
  WHERE m.hardware_access_status <> 'active'
    AND COALESCE(m.hardware_access_reason, '') = 'dues'
    AND m.mips_person_sn IS NOT NULL
    AND (public.member_access_status(m.id, m.branch_id) ->> 'allowed')::boolean IS TRUE
    AND EXISTS (
      SELECT 1 FROM public.memberships ms
      WHERE ms.member_id = m.id
        AND ms.status = 'active'
        AND ms.end_date >= current_date
    );
$fn$;

GRANT EXECUTE ON FUNCTION public.members_restorable_after_dues() TO authenticated, service_role;

-- 3. Flag member for instant gate restore the moment dues clear
CREATE OR REPLACE FUNCTION public.tg_flag_dues_restore_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member uuid;
BEGIN
  v_member := NEW.member_id;
  IF v_member IS NULL THEN RETURN NEW; END IF;

  UPDATE public.members m
     SET hardware_access_reason = 'dues_cleared'
   WHERE m.id = v_member
     AND COALESCE(m.hardware_access_reason, '') = 'dues'
     AND (public.member_access_status(m.id, m.branch_id) ->> 'allowed')::boolean IS TRUE;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_flag_dues_restore_on_payment ON public.payments;
CREATE TRIGGER trg_flag_dues_restore_on_payment
AFTER INSERT OR UPDATE OF status, amount ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_flag_dues_restore_on_payment();
