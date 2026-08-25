REVOKE ALL ON FUNCTION public.log_pt_session(uuid, uuid, text, text, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_pt_session(uuid, uuid, text, text, uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_pt_session(uuid, uuid, text, text, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_pt_session(uuid, uuid, text, text, uuid, date) TO service_role;