-- Phase 4: new functions in public are closed by default.
-- Postgres grants EXECUTE to PUBLIC on every new function (a built-in default that can
-- only be removed with a global default-privilege rule); Supabase additionally pre-grants
-- anon/authenticated/service_role via a public-schema rule. From now on a function
-- created by a migration is reachable only after an explicit GRANT (policy helpers and
-- app-called RPCs grant authenticated; background-only functions rely on service_role).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

-- Guard rail: a trial function created right after this change must not be callable
-- by anon/authenticated but must stay callable by service_role. Fails loudly otherwise.
CREATE FUNCTION public._phase4_default_privs_probe() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
DO $do$
BEGIN
  IF has_function_privilege('anon', 'public._phase4_default_privs_probe()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._phase4_default_privs_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'default EXECUTE privileges for anon/authenticated are still in effect on public functions';
  END IF;
  IF NOT has_function_privilege('service_role', 'public._phase4_default_privs_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost default EXECUTE on public functions';
  END IF;
END
$do$;
DROP FUNCTION public._phase4_default_privs_probe();