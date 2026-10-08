-- Phase 4: relocate relocatable extensions out of the public schema.
-- pg_net is not relocatable (its objects already live in the dedicated "net" schema).
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER EXTENSION vector SET SCHEMA extensions;

-- match_ai_knowledge uses the <=> operator from vector; make it resolvable after the move.
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'match_ai_knowledge'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig);
  END LOOP;
END
$do$;