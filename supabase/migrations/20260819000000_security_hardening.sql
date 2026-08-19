-- Security Hardening Migration
-- This addresses PII scoping, storage leaks, and public access issues.

-- 1. Tighten Leads RLS to prevent broad staff access (Security ID: leads_and_contacts_comm_consent_pii_broad_staff_access)
DROP POLICY IF EXISTS "Staff view leads" ON public.leads;
DROP POLICY IF EXISTS "Staff manage leads" ON public.leads;

CREATE POLICY "Staff read leads in their branches"
ON public.leads
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

CREATE POLICY "Staff manage leads in their branches"
ON public.leads
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
);

-- 2. Restrict Role Capabilities to Management Roles (Security ID: role_capabilities_public_read)
DROP POLICY IF EXISTS "View role capabilities" ON public.role_capabilities;
CREATE POLICY "Management view role capabilities"
ON public.role_capabilities
FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
);

-- Note: has_capability() and other security definer functions can still read this table
-- because they run with the owner's privileges (usually postgres/service_role).

-- 3. Grants for role_capabilities (Required for RLS to work via Data API)
GRANT SELECT ON public.role_capabilities TO authenticated;
GRANT ALL ON public.role_capabilities TO service_role;


-- 4. Storage Bucket Hardening (Security ID: attachments_bucket_read_leak, policy_pdfs_bucket_broad_authenticated_read)

-- Attachments bucket: Granular read based on branch scoping and ownership
DROP POLICY IF EXISTS "Public read for attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read for attachments" ON storage.objects;

CREATE POLICY "Branch-scoped read for attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    (storage.foldername(name))[1] IN ('public', 'branding')
    OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (
      has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
      AND (storage.foldername(name))[1] IN (SELECT user_visible_branch_ids(auth.uid())::text[])
    )
    OR (
      role_name(auth.uid()) = 'trainer'
      AND (storage.foldername(name))[1] IN (SELECT user_visible_branch_ids(auth.uid())::text[])
    )
    OR (
      role_name(auth.uid()) = 'member'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

-- Policy PDFs bucket: Management and scoped access
DROP POLICY IF EXISTS "Authenticated read for policy-pdfs" ON storage.objects;
CREATE POLICY "Management read policy-pdfs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'policy-pdfs'
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (
      has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
      AND (storage.foldername(name))[1] IN (SELECT user_visible_branch_ids(auth.uid())::text[])
    )
  )
);

-- 4. Storage Bucket Hardening (Security ID: attachments_bucket_read_leak, policy_pdfs_bucket_broad_authenticated_read)

-- Attachments bucket: Granular read based on branch scoping and ownership
DROP POLICY IF EXISTS "Public read for attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read for attachments" ON storage.objects;

CREATE POLICY "Branch-scoped read for attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    (storage.foldername(name))[1] IN ('public', 'branding')
    OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (
      has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
      AND (storage.foldername(name))[1] IN (SELECT user_visible_branch_ids(auth.uid())::text[])
    )
    OR (
      role_name(auth.uid()) = 'trainer'
      AND (storage.foldername(name))[1] IN (SELECT user_visible_branch_ids(auth.uid())::text[])
    )
    OR (
      role_name(auth.uid()) = 'member'
      AND (storage.foldername(name))[2] = auth.uid()::text
    )
  )
);

-- Policy PDFs bucket: Management and scoped access
DROP POLICY IF EXISTS "Authenticated read for policy-pdfs" ON storage.objects;
CREATE POLICY "Management read policy-pdfs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'policy-pdfs'
  AND (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (
      has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
      AND (storage.foldername(name))[1] IN (SELECT user_visible_branch_ids(auth.uid())::text[])
    )
  )
);
