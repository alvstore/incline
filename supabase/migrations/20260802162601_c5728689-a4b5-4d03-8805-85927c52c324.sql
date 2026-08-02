-- 1. Members can read line items of their own invoices
CREATE POLICY "Members view own invoice items"
ON public.invoice_items FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.invoices i
  JOIN public.members m ON m.id = i.member_id
  WHERE i.id = invoice_items.invoice_id AND m.user_id = auth.uid()
));

-- 2. Measurements: members insert their own; staff/trainers insert + update
CREATE POLICY "Members record own measurements"
ON public.member_measurements FOR INSERT
TO authenticated
WITH CHECK (member_id IN (SELECT id FROM public.members WHERE user_id = auth.uid()));

CREATE POLICY "Authorized users insert member measurements"
ON public.member_measurements FOR INSERT
TO authenticated
WITH CHECK (public.can_write_member_measurements(auth.uid(), member_id));

CREATE POLICY "Authorized users update member measurements"
ON public.member_measurements FOR UPDATE
TO authenticated
USING (public.can_write_member_measurements(auth.uid(), member_id))
WITH CHECK (public.can_write_member_measurements(auth.uid(), member_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_measurements TO authenticated;
GRANT SELECT ON public.invoice_items TO authenticated;

-- 3. Branding readable by any signed-in user (logo + name only, via a view)
CREATE OR REPLACE VIEW public.org_branding
WITH (security_invoker = off) AS
  SELECT id, name, logo_url FROM public.organization_settings LIMIT 1;

GRANT SELECT ON public.org_branding TO authenticated, anon;

-- 4. Locker request type for member requests
ALTER TYPE public.approval_type ADD VALUE IF NOT EXISTS 'locker_request';

-- 5. Security: stop realtime broadcasting raw gateway payloads
ALTER PUBLICATION supabase_realtime DROP TABLE public.payment_transactions;