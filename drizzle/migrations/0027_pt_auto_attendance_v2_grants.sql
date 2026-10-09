REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_evaluate(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_evaluate(uuid, date) TO service_role;
-- guard-exempt: pt_auto_attendance_config returns only non-sensitive branch toggles (mode, minutes)
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_config(uuid) TO authenticated, service_role;