
-- Branch-scope announcements policies
DROP POLICY IF EXISTS "Admin manage announcements" ON public.announcements;
DROP POLICY IF EXISTS "View active announcements" ON public.announcements;

CREATE POLICY "Owners admins manage all announcements"
  ON public.announcements FOR ALL
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]));

CREATE POLICY "Managers manage announcements in their branches"
  ON public.announcements FOR ALL
  USING (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  );

CREATE POLICY "View active announcements in scope"
  ON public.announcements FOR SELECT
  USING (
    is_active = true
    AND ((publish_at IS NULL) OR (publish_at <= now()))
    AND ((expire_at IS NULL) OR (expire_at > now()))
    AND (
      branch_id IS NULL
      OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
    )
  );

-- Branch-scope benefit_packages SELECT
DROP POLICY IF EXISTS "Anyone can view active packages" ON public.benefit_packages;
CREATE POLICY "View active benefit packages in scope"
  ON public.benefit_packages FOR SELECT
  USING (
    is_active = true
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  );

-- Branch-scope pt_packages SELECT
DROP POLICY IF EXISTS "View pt packages" ON public.pt_packages;
CREATE POLICY "View pt packages in scope"
  ON public.pt_packages FOR SELECT
  USING (
    branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );
