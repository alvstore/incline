REVOKE INSERT, UPDATE ON public.renewal_cases FROM authenticated;
REVOKE INSERT ON public.renewal_case_events FROM authenticated;
DROP POLICY IF EXISTS "Staff update branch renewal cases" ON public.renewal_cases;
DROP POLICY IF EXISTS "Management insert renewal cases" ON public.renewal_cases;
DROP POLICY IF EXISTS "Staff insert branch renewal events" ON public.renewal_case_events;

ALTER FUNCTION public.can_manage_renewal_case(uuid) SECURITY INVOKER;
ALTER FUNCTION public.renewal_center_queue(uuid,text,text,integer,integer) SECURITY INVOKER;
ALTER FUNCTION public.renewal_funnel(uuid,integer) SECURITY INVOKER;

REVOKE EXECUTE ON FUNCTION public.tg_voice_sync_renewal_case() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_renewal_case_sync() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_renewal_case_event(uuid,text,public.renewal_stage,text,text,jsonb) FROM anon;
