CREATE OR REPLACE FUNCTION public.member_holds_plan(_user_id uuid, _plan_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships ms
    JOIN public.members m ON m.id = ms.member_id
    WHERE m.user_id = _user_id AND ms.plan_id = _plan_id
  );
$$;
REVOKE ALL ON FUNCTION public.member_holds_plan(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_holds_plan(uuid, uuid) TO authenticated;

CREATE POLICY "Members read plans they hold" ON public.membership_plans
  FOR SELECT TO authenticated USING (public.member_holds_plan(auth.uid(), id));

CREATE POLICY "Members read benefits of plans they hold" ON public.plan_benefits
  FOR SELECT TO authenticated USING (public.member_holds_plan(auth.uid(), plan_id));