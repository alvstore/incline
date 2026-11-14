INSERT INTO public.app_devices (user_id, install_id, branch_id, person_type, platform, app, push_enabled, first_seen_at, last_seen_at)
SELECT s.user_id,
       'push-' || left(md5(s.endpoint), 24),
       COALESCE(s.branch_id, (SELECT m.branch_id FROM public.members m WHERE m.user_id = s.user_id LIMIT 1)),
       CASE
         WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = s.user_id AND r.role::text IN ('owner','admin')) THEN 'admin'
         WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = s.user_id AND r.role::text = 'manager') THEN 'manager'
         WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = s.user_id AND r.role::text = 'trainer') THEN 'trainer'
         WHEN EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = s.user_id AND r.role::text = 'staff') THEN 'staff'
         ELSE 'member' END,
       CASE
         WHEN lower(coalesce(s.platform,'')) LIKE '%ios%' THEN 'ios'
         WHEN lower(coalesce(s.platform,'')) LIKE '%android%' THEN 'android'
         WHEN s.kind = 'fcm' THEN 'android'
         ELSE 'web_pwa' END,
       CASE WHEN s.kind = 'fcm' THEN 'member_app' ELSE 'web' END,
       true,
       s.created_at,
       COALESCE(s.updated_at, s.created_at)
FROM public.web_push_subscriptions s
WHERE s.user_id IS NOT NULL AND s.endpoint IS NOT NULL
ON CONFLICT (user_id, install_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.purge_stale_app_devices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.app_devices WHERE last_seen_at < now() - interval '365 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.purge_stale_app_devices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_stale_app_devices() TO service_role;

SELECT cron.schedule('purge-stale-app-devices', '30 21 * * 0', 'SELECT public.purge_stale_app_devices()');