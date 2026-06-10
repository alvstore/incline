
-- 1. Restrict expense_category_templates to authenticated only
DROP POLICY IF EXISTS "Anyone can view expense categories" ON public.expense_category_templates;
CREATE POLICY "Authenticated can view expense categories"
  ON public.expense_category_templates
  FOR SELECT
  TO authenticated
  USING (true);

-- 2. Revoke client SELECT on sensitive credential/payload columns
REVOKE SELECT (password) ON public.mips_connections FROM authenticated, anon;
REVOKE SELECT (gateway_signature, webhook_data, response_body) ON public.payment_transactions FROM authenticated, anon;

-- 3. SECURITY DEFINER RPC to fetch webhook payload + response_body + gateway_signature
--    Restricted to owner/admin role only. Service role still has full access.
CREATE OR REPLACE FUNCTION public.get_payment_webhook_payload(p_id uuid)
RETURNS TABLE (
  webhook_data jsonb,
  response_body jsonb,
  gateway_signature text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'owner'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT pt.webhook_data, pt.response_body, pt.gateway_signature
    FROM public.payment_transactions pt
    WHERE pt.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_payment_webhook_payload(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_payment_webhook_payload(uuid) TO authenticated;
