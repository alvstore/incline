
CREATE OR REPLACE FUNCTION public.booking_coverage_enforced(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE WHEN s.value IN ('false'::jsonb, '"false"'::jsonb) THEN false ELSE true END
    FROM public.settings s
    WHERE s.key = 'enforce_booking_coverage' AND (s.branch_id = p_branch_id OR s.branch_id IS NULL)
    ORDER BY (s.branch_id IS NULL) LIMIT 1), true);
$$;

-- Does the member hold an active membership covering this date?
CREATE OR REPLACE FUNCTION public.member_has_active_coverage(p_member_id uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.member_id = p_member_id AND m.status = 'active'
      AND m.start_date <= p_date AND m.end_date >= p_date);
$$;
REVOKE EXECUTE ON FUNCTION public.booking_coverage_enforced(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.member_has_active_coverage(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.booking_coverage_enforced(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_has_active_coverage(uuid, date) TO authenticated, service_role;

-- Facility bookings: slot date must sit inside an active membership (staff force-book exempt; already audited)
CREATE OR REPLACE FUNCTION public.tg_benefit_booking_coverage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_slot RECORD; v_ms RECORD;
BEGIN
  IF NEW.status <> 'booked' OR COALESCE(NEW.force_added, false) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.slot_id IS NOT DISTINCT FROM OLD.slot_id AND OLD.status = 'booked' THEN RETURN NEW; END IF;
  SELECT slot_date, branch_id INTO v_slot FROM benefit_slots WHERE id = NEW.slot_id;
  IF NOT FOUND OR NOT public.booking_coverage_enforced(v_slot.branch_id) THEN RETURN NEW; END IF;
  SELECT status, start_date, end_date INTO v_ms FROM memberships WHERE id = NEW.membership_id;
  IF NOT FOUND OR v_ms.status <> 'active' OR v_slot.slot_date < v_ms.start_date OR v_slot.slot_date > v_ms.end_date THEN
    RAISE EXCEPTION 'membership_not_covering_date: %',
      CASE WHEN FOUND AND v_ms.status = 'active'
        THEN 'Your membership ends on ' || to_char(v_ms.end_date, 'DD Mon') || '. Renew to book after this date.'
        ELSE 'Your membership is not active. Renew to book services.' END
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_benefit_booking_coverage ON public.benefit_bookings;
CREATE TRIGGER trg_benefit_booking_coverage BEFORE INSERT OR UPDATE OF slot_id, status ON public.benefit_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_benefit_booking_coverage();

-- Classes + waitlist: class date (IST) must be covered
CREATE OR REPLACE FUNCTION public.tg_class_booking_coverage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c RECORD; v_date date;
BEGIN
  IF TG_TABLE_NAME = 'class_bookings' AND NEW.status NOT IN ('booked','waitlisted') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('booked','waitlisted','attended') THEN RETURN NEW; END IF;
  SELECT branch_id, scheduled_at INTO v_c FROM classes WHERE id = NEW.class_id;
  IF NOT FOUND OR NOT public.booking_coverage_enforced(v_c.branch_id) THEN RETURN NEW; END IF;
  v_date := (v_c.scheduled_at AT TIME ZONE 'Asia/Kolkata')::date;
  IF NOT public.member_has_active_coverage(NEW.member_id, v_date) THEN
    RAISE EXCEPTION 'membership_not_covering_date: Your membership does not cover %. Renew to book this class.', to_char(v_date, 'DD Mon')
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_class_booking_coverage ON public.class_bookings;
CREATE TRIGGER trg_class_booking_coverage BEFORE INSERT OR UPDATE OF status ON public.class_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_class_booking_coverage();
DROP TRIGGER IF EXISTS trg_class_waitlist_coverage ON public.class_waitlist;
CREATE TRIGGER trg_class_waitlist_coverage BEFORE INSERT ON public.class_waitlist
  FOR EACH ROW EXECUTE FUNCTION public.tg_class_booking_coverage();

-- When a membership ends early / expires / is cancelled: cancel uncovered future facility bookings and return credit
CREATE OR REPLACE FUNCTION public.tg_membership_cancel_uncovered_bookings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; v_cutoff date;
BEGIN
  IF NEW.status IN ('expired','cancelled','transferred') AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_cutoff := LEAST(NEW.end_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  ELSIF NEW.end_date < OLD.end_date THEN
    v_cutoff := NEW.end_date;
  ELSE
    RETURN NEW;
  END IF;
  FOR r IN SELECT b.id FROM benefit_bookings b JOIN benefit_slots s ON s.id = b.slot_id
           WHERE b.membership_id = NEW.id AND b.status IN ('booked','confirmed') AND s.slot_date > v_cutoff
             AND NOT COALESCE(b.force_added, false)
  LOOP
    UPDATE benefit_bookings SET status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'Membership no longer covers this date' WHERE id = r.id;
    BEGIN PERFORM public._release_benefit_for_booking(r.id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_membership_cancel_uncovered_bookings ON public.memberships;
CREATE TRIGGER trg_membership_cancel_uncovered_bookings AFTER UPDATE OF status, end_date ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_membership_cancel_uncovered_bookings();

REVOKE EXECUTE ON FUNCTION public.tg_benefit_booking_coverage() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_class_booking_coverage() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_membership_cancel_uncovered_bookings() FROM PUBLIC, anon, authenticated;
