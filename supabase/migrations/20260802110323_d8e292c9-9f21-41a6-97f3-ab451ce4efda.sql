-- Branch-scope staff access to benefit bookings and credits.
DROP POLICY IF EXISTS "Members can view own bookings" ON public.benefit_bookings;
CREATE POLICY "Members can view own bookings"
ON public.benefit_bookings FOR SELECT
USING (
  member_id IN (SELECT m.id FROM public.members m WHERE m.user_id = auth.uid())
  OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = benefit_bookings.member_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "Members can update own bookings" ON public.benefit_bookings;
CREATE POLICY "Members can update own bookings"
ON public.benefit_bookings FOR UPDATE
USING (
  member_id IN (SELECT m.id FROM public.members m WHERE m.user_id = auth.uid())
  OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = benefit_bookings.member_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "Members can create own bookings" ON public.benefit_bookings;
CREATE POLICY "Members can create own bookings"
ON public.benefit_bookings FOR INSERT
WITH CHECK (
  member_id IN (SELECT m.id FROM public.members m WHERE m.user_id = auth.uid())
  OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = benefit_bookings.member_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "Members can view own credits" ON public.member_benefit_credits;
CREATE POLICY "Members can view own credits"
ON public.member_benefit_credits FOR SELECT
USING (
  member_id IN (SELECT m.id FROM public.members m WHERE m.user_id = auth.uid())
  OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'manager'::app_role,'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_benefit_credits.member_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);