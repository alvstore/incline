-- Advance renewals (status 'pending' until their start date) count as coverage for their own dates.
CREATE OR REPLACE FUNCTION public.member_has_active_coverage(p_member_id uuid, p_date date)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.memberships m
    WHERE m.member_id = p_member_id AND m.status IN ('active','pending')
      AND m.start_date <= p_date AND m.end_date >= p_date);
$function$;

CREATE OR REPLACE FUNCTION public.tg_benefit_booking_coverage()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_slot RECORD; v_ms RECORD;
BEGIN
  IF NEW.status <> 'booked' OR COALESCE(NEW.force_added, false) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.slot_id IS NOT DISTINCT FROM OLD.slot_id AND OLD.status = 'booked' THEN RETURN NEW; END IF;
  SELECT slot_date, branch_id INTO v_slot FROM benefit_slots WHERE id = NEW.slot_id;
  IF NOT FOUND OR NOT public.booking_coverage_enforced(v_slot.branch_id) THEN RETURN NEW; END IF;
  SELECT status, start_date, end_date INTO v_ms FROM memberships WHERE id = NEW.membership_id;
  IF NOT FOUND OR v_ms.status NOT IN ('active','pending') OR v_slot.slot_date < v_ms.start_date OR v_slot.slot_date > v_ms.end_date THEN
    RAISE EXCEPTION 'membership_not_covering_date: %',
      CASE WHEN FOUND AND v_ms.status IN ('active','pending')
        THEN 'Your membership ends on ' || to_char(v_ms.end_date, 'DD Mon') || '. Renew to book after this date.'
        ELSE 'Your membership is not active. Renew to book services.' END
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;

DO $mig$
DECLARE d text; a text; b text;
BEGIN
  d := pg_get_functiondef('public.book_facility_slot(uuid,uuid,uuid,text,uuid,boolean,text)'::regprocedure);
  a := $s$IF v_ms.status <> 'active' OR v_ms.end_date$s$;
  b := $s$WHERE m.id = p_membership_id AND m.status = 'active'
                   AND v_slot.slot_date$s$;
  IF position(a IN d) = 0 OR position(b IN d) = 0 THEN
    RAISE EXCEPTION 'book_facility_slot body changed; aborting';
  END IF;
  d := replace(d, a, $s$IF v_ms.status NOT IN ('active','pending') OR v_ms.end_date$s$);
  d := replace(d, b, $s$WHERE m.id = p_membership_id AND m.status IN ('active','pending')
                   AND v_slot.slot_date$s$);
  EXECUTE d;
END $mig$;