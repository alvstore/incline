REVOKE ALL ON FUNCTION public.member_gate_check_out(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.staff_gate_check_out(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_gate_check_out(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.staff_gate_check_out(uuid, uuid, timestamptz) TO service_role;