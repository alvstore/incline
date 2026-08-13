
-- 1. Tighten Leads PII Access (branch-scoping)
DROP POLICY IF EXISTS "Staff view leads" ON public.leads;
DROP POLICY IF EXISTS "Staff manage leads" ON public.leads;

CREATE POLICY "Staff view leads in their branches"
ON public.leads FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);

CREATE POLICY "Staff manage leads in their branches"
ON public.leads FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);

-- 2. Tighten Profiles PII Access (branch-scoping)
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON public.profiles;

-- 3. Howbody Public Report Tokens hardening
DROP POLICY IF EXISTS "Anyone with token can read" ON public.howbody_public_report_tokens;

CREATE POLICY "Token-based public access"
ON public.howbody_public_report_tokens FOR SELECT TO anon, authenticated
USING (
  expires_at > now() OR expires_at IS NULL
);

CREATE POLICY "Staff manage report tokens"
ON public.howbody_public_report_tokens FOR ALL TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
);

-- 4. Role Capabilities Security
DROP POLICY IF EXISTS "all auth read capabilities" ON public.role_capabilities;
CREATE POLICY "Staff read capabilities"
ON public.role_capabilities FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
);

-- 5. Revoke EXECUTE from Public on sensitive functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

-- 6. Storage hardening (policies on objects)
DROP POLICY IF EXISTS "Public read access for attachments" ON storage.objects;
DROP POLICY IF EXISTS "Staff can read attachments" ON storage.objects;

CREATE POLICY "Staff can read attachments in their branches"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
);

CREATE POLICY "Members read own attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text FROM public.members WHERE user_id = auth.uid()
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.howbody_public_report_tokens TO authenticated;
GRANT ALL ON public.howbody_public_report_tokens TO service_role;
GRANT SELECT ON public.role_capabilities TO authenticated;
GRANT ALL ON public.role_capabilities TO service_role;
