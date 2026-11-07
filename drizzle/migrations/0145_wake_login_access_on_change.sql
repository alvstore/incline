CREATE OR REPLACE FUNCTION public.tg_wake_login_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_member uuid := CASE WHEN TG_TABLE_NAME = 'members' THEN NEW.id ELSE NEW.member_id END;
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.member_login_access_candidates() c WHERE c.member_id = v_member) THEN
      PERFORM net.http_post(
        url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/member-login-access',
        headers := jsonb_build_object('Content-Type','application/json','x-internal-token',public.internal_fn_token()),
        body := jsonb_build_object('action','sweep'));
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; -- never block member/membership writes
  END;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_wake_login_access() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS members_wake_login_access ON public.members;
CREATE TRIGGER members_wake_login_access AFTER UPDATE OF status ON public.members
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.tg_wake_login_access();
DROP TRIGGER IF EXISTS memberships_wake_login_access ON public.memberships;
CREATE TRIGGER memberships_wake_login_access AFTER INSERT OR UPDATE OF status, end_date ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_wake_login_access();