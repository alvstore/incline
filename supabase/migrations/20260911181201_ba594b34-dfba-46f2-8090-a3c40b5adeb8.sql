-- Remove the older 4-argument version so the worker cannot fall back to the
-- previous, cooldown-only selection logic.
DROP FUNCTION IF EXISTS public.voice_retention_candidates(integer, integer, uuid[], integer);
REVOKE EXECUTE ON FUNCTION public.voice_retention_candidates(integer, integer, uuid[], integer, integer, integer) FROM anon, public;