-- Restrict three SELECT policies to authenticated only (drop anon access to org-wide rows).
DROP POLICY IF EXISTS "View active announcements in scope" ON public.announcements;
CREATE POLICY "View active announcements in scope" ON public.announcements
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (publish_at IS NULL OR publish_at <= now())
    AND (expire_at IS NULL OR expire_at > now())
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "View active benefit packages in scope" ON public.benefit_packages;
CREATE POLICY "View active benefit packages in scope" ON public.benefit_packages
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
  );

DROP POLICY IF EXISTS "View pt packages in scope" ON public.pt_packages;
CREATE POLICY "View pt packages in scope" ON public.pt_packages
  FOR SELECT TO authenticated
  USING (
    branch_id IS NULL OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

-- Re-apply column-level REVOKE on mips_connections.password (defense-in-depth;
-- only service_role may read the raw device password through PostgREST).
REVOKE SELECT (password) ON public.mips_connections FROM anon, authenticated;