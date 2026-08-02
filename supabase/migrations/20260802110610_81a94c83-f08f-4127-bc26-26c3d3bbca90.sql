-- class_bookings
DROP POLICY IF EXISTS "Staff manage bookings" ON public.class_bookings;
CREATE POLICY "Staff manage bookings" ON public.class_bookings
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = class_bookings.class_id
      AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = class_bookings.class_id
      AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

-- class_waitlist
DROP POLICY IF EXISTS "staff_access_waitlist" ON public.class_waitlist;
CREATE POLICY "staff_access_waitlist" ON public.class_waitlist
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = class_waitlist.class_id
      AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  AND EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = class_waitlist.class_id
      AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

-- pt_sessions
DROP POLICY IF EXISTS "Staff manage pt sessions" ON public.pt_sessions;
CREATE POLICY "Staff manage pt sessions" ON public.pt_sessions
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'trainer'::app_role])
  AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'trainer'::app_role])
  AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- meal_catalog
DROP POLICY IF EXISTS "Staff manage meal_catalog" ON public.meal_catalog;
CREATE POLICY "Staff manage meal_catalog" ON public.meal_catalog
FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
  AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
  AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
);

-- trainer_availability
DROP POLICY IF EXISTS "staff_access_trainer_availability" ON public.trainer_availability;
DROP POLICY IF EXISTS "trainer_manage_own_availability" ON public.trainer_availability;
CREATE POLICY "trainer_manage_own_availability" ON public.trainer_availability
FOR ALL TO authenticated
USING (
  trainer_id IN (SELECT t.id FROM public.trainers t WHERE t.user_id = auth.uid())
  OR (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = trainer_availability.trainer_id
        AND (t.branch_id IS NULL OR t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
    )
  )
)
WITH CHECK (
  trainer_id IN (SELECT t.id FROM public.trainers t WHERE t.user_id = auth.uid())
  OR (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = trainer_availability.trainer_id
        AND (t.branch_id IS NULL OR t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
    )
  )
);

DROP POLICY IF EXISTS "view_trainer_availability" ON public.trainer_availability;
CREATE POLICY "view_trainer_availability" ON public.trainer_availability
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
  AND EXISTS (
    SELECT 1 FROM public.trainers t
    WHERE t.id = trainer_availability.trainer_id
      AND (t.branch_id IS NULL OR t.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  )
);

-- referral_settings
DROP POLICY IF EXISTS "Authenticated can view referral settings" ON public.referral_settings;
DROP POLICY IF EXISTS "Managers view referral settings" ON public.referral_settings;
CREATE POLICY "Staff view branch referral settings" ON public.referral_settings
FOR SELECT TO authenticated
USING (
  (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  )
  OR EXISTS (
    SELECT 1 FROM public.members m
    WHERE m.user_id = auth.uid()
      AND (referral_settings.branch_id IS NULL OR referral_settings.branch_id = m.branch_id)
  )
);
