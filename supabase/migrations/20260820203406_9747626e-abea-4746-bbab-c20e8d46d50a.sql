-- Revoke EXECUTE from PUBLIC and authenticated roles for sensitive SECURITY DEFINER functions
-- This hardens the system by ensuring only the service_role or specific authorized flows can invoke them.

-- 1. Revoke from tg_auto_evaluate_member_access (just created)
REVOKE EXECUTE ON FUNCTION public.tg_auto_evaluate_member_access() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_auto_evaluate_member_access() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tg_auto_evaluate_member_access() TO service_role;

-- 2. Revoke from evaluate_member_access_state
REVOKE EXECUTE ON FUNCTION public.evaluate_member_access_state(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.evaluate_member_access_state(uuid, uuid, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_member_access_state(uuid, uuid, text, boolean) TO service_role;

-- 3. Revoke from tg_sync_hardware_access_to_mips
REVOKE EXECUTE ON FUNCTION public.tg_sync_hardware_access_to_mips() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_sync_hardware_access_to_mips() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tg_sync_hardware_access_to_mips() TO service_role;

-- 4. Revoke from tg_flag_dues_restore_on_payment
REVOKE EXECUTE ON FUNCTION public.tg_flag_dues_restore_on_payment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_flag_dues_restore_on_payment() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tg_flag_dues_restore_on_payment() TO service_role;

-- Note: We keep service_role access as edge functions and triggers (which run as table owners/service_role) need these.
