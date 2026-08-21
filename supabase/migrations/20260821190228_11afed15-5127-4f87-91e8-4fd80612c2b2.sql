-- Secure SECURITY DEFINER functions from public execution
REVOKE EXECUTE ON FUNCTION public.tg_sync_hardware_access_to_mips() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.tg_sync_hardware_access_to_mips() TO service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
