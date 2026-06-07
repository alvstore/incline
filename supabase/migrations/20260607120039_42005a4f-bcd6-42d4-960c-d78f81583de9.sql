-- Grant EXECUTE on log_error_event so frontend (anon + authenticated) can log errors
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'log_error_event'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
  END LOOP;
END $$;

-- Grant SELECT on branches to authenticated (RLS already restricts rows)
GRANT SELECT ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;