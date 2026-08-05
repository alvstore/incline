CREATE OR REPLACE FUNCTION public.can_read_policy_pdf(_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR EXISTS (
      SELECT 1
      FROM public.policies p
      JOIN public.user_roles ur ON ur.user_id = auth.uid()
      WHERE p.is_active
        AND (
          _object_name LIKE '%' || p.id::text || '%'
          OR _object_name LIKE '%' || p.code || '%'
        )
        AND ur.role::text = ANY (p.applicable_roles)
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_policy_pdf(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_policy_pdf(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "policy_pdfs_authed_read" ON storage.objects;

CREATE POLICY "policy_pdfs_role_scoped_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'policy-pdfs'
    AND public.can_read_policy_pdf(name)
  );