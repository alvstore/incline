CREATE OR REPLACE FUNCTION public.tg_renewal_case_supersede()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  -- BEFORE INSERT also fires for upserts that end in ON CONFLICT UPDATE, so never close the case for the same membership.
  FOR r IN SELECT id, branch_id, stage FROM public.renewal_cases
           WHERE member_id = NEW.member_id AND closed_at IS NULL AND id <> NEW.id
             AND membership_id IS DISTINCT FROM NEW.membership_id
  LOOP
    UPDATE public.renewal_cases
       SET closed_at = now(), outcome = COALESCE(outcome, 'superseded'), updated_at = now()
     WHERE id = r.id;
    INSERT INTO public.renewal_case_events(case_id, branch_id, event_type, stage, detail)
    VALUES (r.id, r.branch_id, 'superseded', r.stage, 'Closed because a newer membership cycle opened');
  END LOOP;
  RETURN NEW;
END $function$;