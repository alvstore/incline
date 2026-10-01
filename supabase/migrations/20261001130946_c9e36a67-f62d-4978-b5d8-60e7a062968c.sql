ALTER TABLE public.benefit_settings ADD COLUMN IF NOT EXISTS min_advance_booking_hours integer NOT NULL DEFAULT 0 CHECK (min_advance_booking_hours >= 0 AND min_advance_booking_hours <= 168);

UPDATE public.benefit_settings bs SET min_advance_booking_hours = 24
FROM public.benefit_types bt
WHERE bt.id = bs.benefit_type_id AND (bt.code ILIKE '%steam%' OR bt.name ILIKE '%steam%');
UPDATE public.benefit_settings SET min_advance_booking_hours = 24 WHERE benefit_type::text ILIKE '%steam%';

DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p WHERE proname='book_facility_slot' AND pronamespace='public'::regnamespace;
  d := replace(d,
$a$    IF v_slot_dt > now() + (v_window_hours || ' hours')::interval THEN$a$,
$b$    IF p_source NOT IN ('concierge','admin')
       AND COALESCE(v_settings.min_advance_booking_hours, 0) > 0
       AND v_slot_dt < now() + (v_settings.min_advance_booking_hours || ' hours')::interval THEN
      RETURN jsonb_build_object('success', false, 'error',
        format('This slot must be booked at least %s hours in advance. Please pick a later slot or contact the front desk.', v_settings.min_advance_booking_hours));
    END IF;

    IF v_slot_dt > now() + (v_window_hours || ' hours')::interval THEN$b$);
  IF position('min_advance_booking_hours' in d) = 0 THEN RAISE EXCEPTION 'patch failed'; END IF;
  EXECUTE d;
END $mig$;