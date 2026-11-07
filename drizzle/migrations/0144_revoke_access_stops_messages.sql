CREATE OR REPLACE FUNCTION public.is_recipient_access_revoked(p_member_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('is_recipient_access_revoked')
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[]) THEN
    RAISE EXCEPTION 'forbidden: is_recipient_access_revoked' USING ERRCODE = '42501';
  END IF;
  RETURN
    EXISTS (SELECT 1 FROM public.members m WHERE m.id = p_member_id AND m.login_disabled_at IS NOT NULL)
    OR (p_user_id IS NOT NULL AND (
      (EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = p_user_id AND m.login_disabled_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_user_id AND r.role <> 'member'))
      OR
      ((EXISTS (SELECT 1 FROM public.trainers t WHERE t.user_id = p_user_id AND t.is_active = false AND t.exit_date IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.employees e WHERE e.user_id = p_user_id AND e.is_active = false AND e.exit_date IS NOT NULL))
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p_user_id AND r.role IN ('owner','admin'))
       AND NOT EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = p_user_id AND m.login_disabled_at IS NULL AND m.status = 'active'))
    ));
END $$;
REVOKE EXECUTE ON FUNCTION public.is_recipient_access_revoked(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_recipient_access_revoked(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_notifications_skip_revoked()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND public.is_recipient_access_revoked(NULL, NEW.user_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_notifications_skip_revoked() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS notifications_skip_revoked ON public.notifications;
CREATE TRIGGER notifications_skip_revoked BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_skip_revoked();

CREATE OR REPLACE FUNCTION public.tg_purge_push_on_revoke()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND public.is_recipient_access_revoked(NULL, NEW.user_id) THEN
    DELETE FROM public.web_push_subscriptions WHERE user_id = NEW.user_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_purge_push_on_revoke() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS members_purge_push_on_revoke ON public.members;
CREATE TRIGGER members_purge_push_on_revoke AFTER UPDATE OF login_disabled_at ON public.members
  FOR EACH ROW WHEN (NEW.login_disabled_at IS NOT NULL AND OLD.login_disabled_at IS NULL)
  EXECUTE FUNCTION public.tg_purge_push_on_revoke();
DROP TRIGGER IF EXISTS trainers_purge_push_on_revoke ON public.trainers;
CREATE TRIGGER trainers_purge_push_on_revoke AFTER UPDATE OF is_active, exit_date ON public.trainers
  FOR EACH ROW WHEN (NEW.is_active = false AND NEW.exit_date IS NOT NULL)
  EXECUTE FUNCTION public.tg_purge_push_on_revoke();
DROP TRIGGER IF EXISTS employees_purge_push_on_revoke ON public.employees;
CREATE TRIGGER employees_purge_push_on_revoke AFTER UPDATE OF is_active, exit_date ON public.employees
  FOR EACH ROW WHEN (NEW.is_active = false AND NEW.exit_date IS NOT NULL)
  EXECUTE FUNCTION public.tg_purge_push_on_revoke();

CREATE OR REPLACE FUNCTION public.member_login_access_pending()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.member_login_access_candidates());
$$;
REVOKE EXECUTE ON FUNCTION public.member_login_access_pending() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_login_access_pending() TO service_role;