REVOKE EXECUTE ON FUNCTION public.mips_claim_dispatch_slot(integer, uuid, integer, integer, integer) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mips_release_dispatch_slot(integer) FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mips_claim_full_sync(integer, integer, boolean) FROM authenticated, anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.mips_claim_dispatch_slot(integer, uuid, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mips_release_dispatch_slot(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mips_claim_full_sync(integer, integer, boolean) TO service_role;