DO $$
DECLARE
  u uuid := '473dd639-9488-4f1b-96b7-07b493348932';
BEGIN
  DELETE FROM public.user_roles WHERE user_id = u;
  DELETE FROM public.user_active_branch WHERE user_id = u;
  DELETE FROM public.notifications WHERE user_id = u;
  DELETE FROM public.notification_preferences WHERE user_id = u;
  DELETE FROM public.profiles WHERE id = u;
  DELETE FROM auth.users WHERE id = u;
END $$;