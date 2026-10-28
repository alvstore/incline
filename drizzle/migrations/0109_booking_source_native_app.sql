-- Booking source: allow the native member app (Android / iOS) as a tracked facility-booking channel.
ALTER TABLE public.benefit_bookings DROP CONSTRAINT IF EXISTS benefit_bookings_source_check;
ALTER TABLE public.benefit_bookings ADD CONSTRAINT benefit_bookings_source_check
  CHECK (source = ANY (ARRAY['member_portal','concierge','whatsapp_ai','admin','system','app_android','app_ios']::text[]));

-- Patch book_facility_slot in place (keeps every other rule byte-identical):
--  * signed-in members may self-report app_android / app_ios; any other member value is forced to member_portal
--  * the source allow-list accepts the two app channels
DO $mig$
DECLARE
  d text;
  old_member text := E'      p_source := ''member_portal'';\n';
  new_member text := E'      -- v3: members may only self-report a native-app channel; anything else is the web portal\n      IF p_source IS NULL OR p_source NOT IN (''app_android'',''app_ios'') THEN\n        p_source := ''member_portal'';\n      END IF;\n';
  old_list text := $q$IF p_source NOT IN ('member_portal','concierge','whatsapp_ai','admin','system') THEN$q$;
  new_list text := $q$IF p_source NOT IN ('member_portal','concierge','whatsapp_ai','admin','system','app_android','app_ios') THEN$q$;
BEGIN
  d := pg_get_functiondef('public.book_facility_slot(uuid,uuid,uuid,text,uuid,boolean,text)'::regprocedure);
  IF position(old_member IN d) = 0 OR position(old_list IN d) = 0 THEN
    RAISE EXCEPTION 'book_facility_slot body changed; source patch not applied';
  END IF;
  d := replace(d, old_member, new_member);
  d := replace(d, old_list, new_list);
  EXECUTE d;
END
$mig$;