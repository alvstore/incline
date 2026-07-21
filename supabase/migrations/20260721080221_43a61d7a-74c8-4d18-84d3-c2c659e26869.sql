
CREATE OR REPLACE FUNCTION public.tg_members_after_insert_provision_login()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_url  text := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/provision-member-login';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo';
BEGIN
  -- Skip if already linked or no lead to source PII from
  IF NEW.user_id IS NOT NULL OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon,
      'x-lovable-system', '1'
    ),
    body    := jsonb_build_object('member_id', NEW.id)
  );
  RAISE LOG 'provision-member-login dispatched for member_id=%', NEW.id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'provision-member-login dispatch failed for member_id=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS members_after_insert_provision_login ON public.members;
CREATE TRIGGER members_after_insert_provision_login
  AFTER INSERT ON public.members
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_members_after_insert_provision_login();
