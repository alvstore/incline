-- Branch-scope manager access to sensitive contract/signature storage.
CREATE OR REPLACE FUNCTION public.can_access_contract_object(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]) THEN true
      WHEN has_role(auth.uid(), 'manager'::app_role) THEN EXISTS (
        SELECT 1 FROM public.contracts c
        WHERE c.id::text = split_part(_path, '/', 1)
          AND c.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
      ELSE false
    END
$$;

REVOKE ALL ON FUNCTION public.can_access_contract_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_contract_object(text) TO authenticated, service_role;

DROP POLICY IF EXISTS contract_pdfs_admin_all ON storage.objects;
CREATE POLICY contract_pdfs_admin_all ON storage.objects
FOR ALL TO authenticated
USING (bucket_id = 'contract-pdfs' AND public.can_access_contract_object(name))
WITH CHECK (bucket_id = 'contract-pdfs' AND public.can_access_contract_object(name));

DROP POLICY IF EXISTS signature_assets_admin_all ON storage.objects;
CREATE POLICY signature_assets_admin_all ON storage.objects
FOR ALL TO authenticated
USING (bucket_id = 'signature-assets' AND public.can_access_contract_object(name))
WITH CHECK (bucket_id = 'signature-assets' AND public.can_access_contract_object(name));