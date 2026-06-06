
-- 1. Branches: remove broad anon SELECT, expose only safe columns via SECURITY DEFINER RPC
DROP POLICY IF EXISTS "Public can view active branches" ON public.branches;
REVOKE SELECT ON public.branches FROM anon;

CREATE OR REPLACE FUNCTION public.get_public_branches()
RETURNS TABLE (id uuid, name text, city text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.city
  FROM public.branches b
  WHERE b.is_active = true
  ORDER BY b.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_branches() TO anon, authenticated;

-- 2. Staff WhatsApp routing: restrict SELECT — peers no longer see personal_phone
DROP POLICY IF EXISTS "Staff can view routing in branch" ON public.staff_whatsapp_routing;

CREATE POLICY "View own routing or admin"
ON public.staff_whatsapp_routing
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
);

-- 3. OTP verifications: explicit deny SELECT (defense in depth)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'otp_verifications' AND relnamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER TABLE public.otp_verifications ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "Deny all client reads" ON public.otp_verifications';
    EXECUTE 'CREATE POLICY "Deny all client reads" ON public.otp_verifications FOR SELECT TO anon, authenticated USING (false)';
  END IF;
END $$;
