GRANT EXECUTE ON FUNCTION public.dr_is_operational() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO anon, authenticated;