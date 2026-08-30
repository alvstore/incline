REVOKE ALL ON FUNCTION public.whatsapp_pace_cooldown_hours() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_pace_cooldown_hours() FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_pace_cooldown_hours() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_pace_cooldown_hours() TO service_role;