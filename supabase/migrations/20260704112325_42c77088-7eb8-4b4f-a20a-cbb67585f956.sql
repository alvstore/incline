-- =========================================================
-- LOCKERS + LOCKER ASSIGNMENTS: branch scoping via lockers.branch_id
-- =========================================================
DROP POLICY IF EXISTS "staff_access_lockers" ON public.lockers;
CREATE POLICY "staff_access_lockers"
ON public.lockers
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "staff_access_locker_assignments" ON public.locker_assignments;
CREATE POLICY "staff_access_locker_assignments"
ON public.locker_assignments
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.lockers l
      WHERE l.id = locker_assignments.locker_id
        AND l.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.lockers l
      WHERE l.id = locker_assignments.locker_id
        AND l.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- =========================================================
-- MEMBER_BENEFIT_CREDITS: branch scoping via members.branch_id
-- =========================================================
DROP POLICY IF EXISTS "Staff can manage credits" ON public.member_benefit_credits;
CREATE POLICY "Staff can manage credits"
ON public.member_benefit_credits
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_benefit_credits.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = member_benefit_credits.member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- =========================================================
-- MEMBER_GROUPS: branch scoping via own branch_id column
-- =========================================================
DROP POLICY IF EXISTS "Staff manage member_groups" ON public.member_groups;
CREATE POLICY "Staff manage member_groups"
ON public.member_groups
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- =========================================================
-- MEMBER_GROUP_MEMBERS: branch scoping via parent group's branch_id
-- =========================================================
DROP POLICY IF EXISTS "Staff manage member_group_members" ON public.member_group_members;
CREATE POLICY "Staff manage member_group_members"
ON public.member_group_members
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.member_groups g
      WHERE g.id = member_group_members.group_id
        AND g.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.member_groups g
      WHERE g.id = member_group_members.group_id
        AND g.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- =========================================================
-- REFERRALS: branch scoping via referrer member's branch_id
-- Members still see their own referrals (referrer_member_id = get_member_id(auth.uid()))
-- =========================================================
DROP POLICY IF EXISTS "member_access_referrals" ON public.referrals;
CREATE POLICY "member_access_referrals"
ON public.referrals
FOR ALL
TO authenticated
USING (
  referrer_member_id = get_member_id(auth.uid())
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = referrals.referrer_member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  referrer_member_id = get_member_id(auth.uid())
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    AND EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.id = referrals.referrer_member_id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  )
);

-- =========================================================
-- REALTIME.MESSAGES: remove overly broad policies, add branch-scoped INSERT.
-- Keep the existing 'realtime_messages_branch_scoped_select' as sole SELECT.
-- =========================================================
DROP POLICY IF EXISTS "Authenticated staff can receive realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated staff can send realtime messages" ON realtime.messages;

CREATE POLICY "realtime_messages_branch_scoped_insert"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND (
      realtime.topic() !~ 'branch:[0-9a-f-]{36}'
      OR EXISTS (
        SELECT 1
        FROM user_visible_branch_ids(auth.uid()) b(branch_id)
        WHERE realtime.topic() LIKE ('%branch:' || b.branch_id::text || '%')
      )
    )
  )
);