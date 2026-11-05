CREATE TABLE public.sales_quote_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid,
  lead_id uuid,
  channel text NOT NULL CHECK (channel IN ('web_chat','whatsapp')),
  event text NOT NULL CHECK (event IN ('price_quoted','offer_revealed','floor_offered','desk_handoff','payment_link_sent','payment_link_paid','addon_prices_shown')),
  plan_id uuid,
  amount numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_quote_events_lead_idx ON public.sales_quote_events (lead_id, created_at DESC);
CREATE INDEX sales_quote_events_branch_idx ON public.sales_quote_events (branch_id, created_at DESC);
GRANT SELECT ON public.sales_quote_events TO authenticated;
GRANT ALL ON public.sales_quote_events TO service_role;
ALTER TABLE public.sales_quote_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read sales quote events" ON public.sales_quote_events FOR SELECT TO authenticated
USING ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::text[])) OR branch_id IN (SELECT public.managed_branch_ids(auth.uid())));

CREATE TABLE public.sales_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 1),
  stage text NOT NULL,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','cancelled','expired')),
  gateway_link_id text UNIQUE,
  short_url text,
  paid_at timestamptz,
  gateway_payment_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sales_payment_links_one_live ON public.sales_payment_links (lead_id, plan_id, amount) WHERE status = 'created';
GRANT SELECT ON public.sales_payment_links TO authenticated;
GRANT ALL ON public.sales_payment_links TO service_role;
ALTER TABLE public.sales_payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read sales payment links" ON public.sales_payment_links FOR SELECT TO authenticated
USING ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::text[])) OR branch_id IN (SELECT public.managed_branch_ids(auth.uid())));

INSERT INTO public.settings (branch_id, key, value)
SELECT NULL, k, '{"enabled": true}'::jsonb FROM (VALUES ('sales_chat_payment_links'),('sales_member_addon_prices')) v(k)
WHERE NOT EXISTS (SELECT 1 FROM public.settings s WHERE s.branch_id IS NULL AND s.key = v.k);