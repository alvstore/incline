CREATE OR REPLACE FUNCTION public.tg_wake_login_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  v_member uuid;
BEGIN
  BEGIN
    v_member := CASE WHEN TG_TABLE_NAME = 'members' THEN (v_row->>'id')::uuid ELSE (v_row->>'member_id')::uuid END;
    IF EXISTS (SELECT 1 FROM public.member_login_access_candidates() c WHERE c.member_id = v_member) THEN
      PERFORM net.http_post(
        url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/member-login-access',
        headers := jsonb_build_object('Content-Type','application/json','x-internal-token',public.internal_fn_token()),
        body := jsonb_build_object('action','sweep'));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; -- never block member/membership writes
  END;
  RETURN NULL;
END $function$;