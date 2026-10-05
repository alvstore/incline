REVOKE EXECUTE ON FUNCTION public._refresh_class_booked_count(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._release_class_benefit_usage(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_class_session(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_class_session(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_class_template(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_class_sessions(uuid, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.member_matches_segment(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.override_class_session(uuid, uuid, text, integer, time without time zone, integer, text, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reinstate_class_session(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tg_class_templates_after_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_class_types_after_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_sync_class_booked_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._refresh_class_booked_count(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._release_class_benefit_usage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_class_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_class_session(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_class_template(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_class_sessions(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_matches_segment(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.override_class_session(uuid, uuid, text, integer, time without time zone, integer, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reinstate_class_session(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tg_class_templates_after_write() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_class_types_after_update() TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_sync_class_booked_count() TO service_role;
GRANT ALL ON public.mips_member_locks TO service_role;
CREATE POLICY "Owners and admins can view MIPS locks" ON public.mips_member_locks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));