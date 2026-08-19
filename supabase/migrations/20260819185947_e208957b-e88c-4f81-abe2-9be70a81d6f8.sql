-- Security Hardening Migration V3 (Fixed Syntax)
DROP POLICY IF EXISTS "Staff view leads" ON public.leads;
DROP POLICY IF EXISTS "Staff manage leads" ON public.leads;
DROP POLICY IF EXISTS "Owner/Admin read all leads" ON public.leads;
DROP POLICY IF EXISTS "Staff read leads in their branches" ON public.leads;
DROP POLICY IF EXISTS "Owner/Admin manage all leads" ON public.leads;
DROP POLICY IF EXISTS "Staff manage leads in their branches" ON public.leads;

CREATE POLICY "Owner/Admin read all leads"
ON public.leads FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Staff read leads in their branches"
ON public.leads FOR SELECT TO authenticated
USING (
  (public.has_any_role(auth.uid(), ARRAY['manager'::public.app_role, 'staff'::public.app_role]))
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);

CREATE POLICY "Owner/Admin manage all leads"
ON public.leads FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role]));

CREATE POLICY "Staff manage leads in their branches"
ON public.leads FOR ALL TO authenticated
USING (
  (public.has_any_role(auth.uid(), ARRAY['manager'::public.app_role, 'staff'::public.app_role]))
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
)
WITH CHECK (
  (public.has_any_role(auth.uid(), ARRAY['manager'::public.app_role, 'staff'::public.app_role]))
  AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
);

DROP POLICY IF EXISTS "View role capabilities" ON public.role_capabilities;
CREATE POLICY "Management view role capabilities"
ON public.role_capabilities FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role]));

DROP POLICY IF EXISTS "Staff read profiles in their branches" ON public.profiles;
CREATE POLICY "Staff read profiles in their branches"
ON public.profiles FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::public.app_role, 'staff'::public.app_role, 'trainer'::public.app_role])
    AND (
      EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = profiles.id AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR EXISTS (SELECT 1 FROM public.leads l WHERE (l.phone = profiles.phone OR l.email = profiles.email) AND l.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS "Attachments access control" ON storage.objects;
CREATE POLICY "Attachments access control"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attachments'
  AND (
    public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role])
    OR owner = auth.uid()
  )
);

DROP POLICY IF EXISTS "policy_pdfs_read_scoped" ON storage.objects;
CREATE POLICY "policy_pdfs_read_scoped"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'policy-pdfs' 
  AND (
    public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role, 'staff'::public.app_role])
    OR (EXISTS (SELECT 1 FROM public.members m WHERE m.user_id = auth.uid()))
  )
);

GRANT SELECT ON public.role_capabilities TO authenticated;
GRANT ALL ON public.role_capabilities TO service_role;
GRANT SELECT ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
