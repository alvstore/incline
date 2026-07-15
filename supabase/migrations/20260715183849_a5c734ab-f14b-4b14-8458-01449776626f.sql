-- Members must be read-only on referral/reward data; staff retain write access.

DROP POLICY IF EXISTS member_access_referrals ON public.referrals;
DROP POLICY IF EXISTS staff_manage_referrals ON public.referrals;

CREATE POLICY member_read_own_referrals
ON public.referrals
FOR SELECT
TO authenticated
USING (referrer_member_id = public.get_member_id(auth.uid()));

CREATE POLICY staff_manage_referrals
ON public.referrals
FOR ALL
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role])
  AND (
    public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role])
    OR EXISTS (
      SELECT 1
      FROM public.members m
      WHERE m.id = referrals.referrer_member_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
)
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role])
  AND (
    public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role])
    OR EXISTS (
      SELECT 1
      FROM public.members m
      WHERE m.id = referrals.referrer_member_id
        AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS member_access_rewards ON public.referral_rewards;
DROP POLICY IF EXISTS staff_manage_rewards ON public.referral_rewards;

CREATE POLICY member_read_own_referral_rewards
ON public.referral_rewards
FOR SELECT
TO authenticated
USING (member_id = public.get_member_id(auth.uid()));

CREATE POLICY staff_manage_referral_rewards
ON public.referral_rewards
FOR ALL
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role]));