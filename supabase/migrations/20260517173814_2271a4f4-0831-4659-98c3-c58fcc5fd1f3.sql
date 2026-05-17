
-- 1. Pin search_path on the four email queue helper functions
ALTER FUNCTION public.enqueue_email(text, jsonb)         SET search_path = public, pgmq, pg_temp;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq, pg_temp;
ALTER FUNCTION public.delete_email(text, bigint)         SET search_path = public, pgmq, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb)   SET search_path = public, pgmq, pg_temp;

-- 2. Revoke EXECUTE from anon on every SECURITY DEFINER function in public
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosecdef = true
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;
