CREATE OR REPLACE FUNCTION public.user_scope_branch_ids(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.user_visible_branch_ids(p_user_id)
  UNION
  SELECT m.branch_id FROM public.members m
   WHERE m.user_id = p_user_id AND m.branch_id IS NOT NULL
$$;

GRANT EXECUTE ON FUNCTION public.user_scope_branch_ids(uuid) TO authenticated;

-- ad_banners: scope reads to the user's branches (global banners stay visible)
DROP POLICY IF EXISTS "Authenticated users can read banners" ON public.ad_banners;
CREATE POLICY "Branch scoped banner read"
ON public.ad_banners
FOR SELECT
TO authenticated
USING (
  branch_id IS NULL
  OR branch_id IN (SELECT public.user_scope_branch_ids(auth.uid()))
);

-- plan_benefits: scope reads to benefits of plans in the user's branches
DROP POLICY IF EXISTS "View plan benefits" ON public.plan_benefits;
CREATE POLICY "Branch scoped plan benefit read"
ON public.plan_benefits
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.membership_plans mp
     WHERE mp.id = plan_benefits.plan_id
       AND (
         mp.branch_id IS NULL
         OR mp.branch_id IN (SELECT public.user_scope_branch_ids(auth.uid()))
       )
  )
);