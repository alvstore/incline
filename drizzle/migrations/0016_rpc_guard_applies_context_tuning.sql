-- rpc_guard_applies: refine context detection.
--  * request.path NULL  -> not a Data API call (Realtime / Storage policy evaluation, psql, cron):
--                          no user-driven function call is possible there, so the guard does not apply.
--  * '/rpc/graphql'     -> a user reached a function through the GraphQL endpoint: always enforce.
--  * otherwise          -> enforce only when the user called THIS function directly.
CREATE OR REPLACE FUNCTION public.rpc_guard_applies(p_fn text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_service_request() THEN false
    WHEN pg_trigger_depth() > 0 THEN false
    WHEN current_setting('request.path', true) IS NULL THEN false
    WHEN current_setting('request.path', true) = '/rpc/graphql' THEN true
    ELSE current_setting('request.path', true) = '/rpc/' || p_fn
  END;
$$;