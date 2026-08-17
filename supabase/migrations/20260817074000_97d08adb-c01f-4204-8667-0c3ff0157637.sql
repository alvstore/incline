
-- 1. Tighten Profiles RLS to prevent broad staff access (Security ID: profiles_broad_staff_pii_read)
DROP POLICY IF EXISTS "Staff view profiles for management" ON public.profiles;
DROP POLICY IF EXISTS "Staff read profiles in their branches" ON public.profiles;

CREATE POLICY "Staff read profiles in their branches"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
    AND (
      -- Can see members in their branches
      EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.user_id = profiles.id
        AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
      OR
      -- Can see leads in their branches (Note: leads uses assigned_to, not user_id directly, but profiles.id is compared against the result)
      -- If we want to link leads to profiles, we typically look for phone/email matches, 
      -- but here we rely on profiles being linked to the authenticated user.
      EXISTS (
        SELECT 1 FROM public.leads l
        WHERE (l.phone = profiles.phone OR l.email = profiles.email)
        AND l.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
      OR
      -- Can see their own profile
      id = auth.uid()
    )
  )
);

-- 2. Scoped Storage access for policy-pdfs (Security ID: policy_pdfs_bucket_broad_authenticated_read)
DROP POLICY IF EXISTS "policy_pdfs_read_scoped" ON storage.objects;
CREATE POLICY "policy_pdfs_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'policy-pdfs' 
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    OR (
      EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.user_id = auth.uid()
      )
    )
  )
);

-- 3. Revoke public execution on remaining sensitive RPCs
REVOKE ALL ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, service_role;

-- 4. Secure the attachments bucket (Security ID: attachments_bucket_read_leak)
DROP POLICY IF EXISTS "Public read access for attachments" ON storage.objects;
DROP POLICY IF EXISTS "Attachments owner or scoped staff can read" ON storage.objects;

CREATE POLICY "Attachments access control"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
    OR owner = auth.uid()
  )
);
