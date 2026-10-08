-- Supabase default privileges grant EXECUTE to anon on new functions; the guard helpers
-- are for signed-in users and backend code only.
REVOKE ALL ON FUNCTION public.is_branch_staff(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_branch_staff(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_own_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_branch_staff(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_branch_staff(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_own_member(uuid) TO authenticated, service_role;