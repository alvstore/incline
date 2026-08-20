GRANT EXECUTE ON FUNCTION public.dr_get_or_create_token() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dr_table_counts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dr_get_replication_tables() TO authenticated, service_role;
GRANT SELECT ON public.settings TO authenticated, service_role;
