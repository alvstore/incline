DO $$
BEGIN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.dr_get_or_create_token() TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.dr_table_counts() TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.dr_get_replication_tables() TO service_role';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role';
    EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA private TO service_role';
END $$;

SELECT token FROM private.dr_config WHERE id = true;
