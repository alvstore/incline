DROP VIEW IF EXISTS public.org_branding;

CREATE OR REPLACE FUNCTION public.get_org_branding()
RETURNS TABLE (name text, logo_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT os.name, os.logo_url FROM public.organization_settings os LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_org_branding() TO authenticated, anon;