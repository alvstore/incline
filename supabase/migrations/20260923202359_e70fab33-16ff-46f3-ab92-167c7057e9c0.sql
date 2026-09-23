CREATE OR REPLACE FUNCTION public.is_staff_offboarded(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trainers t
    WHERE t.user_id = _user_id AND t.is_active = false AND t.exit_date IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.user_id = _user_id AND e.is_active = false AND e.exit_date IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_staff_offboarded(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_offboarded(uuid) TO authenticated, service_role;