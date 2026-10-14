
-- 15-Day "Honeymoon" Annual Upgrade Automation — Epic 1
-- upgrade_offers table + guarded RPCs + auto-offer trigger on short-term memberships.

CREATE TABLE public.upgrade_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  member_id UUID NOT NULL REFERENCES public.members(id),
  membership_id UUID NOT NULL UNIQUE REFERENCES public.memberships(id),
  target_plan_id UUID REFERENCES public.membership_plans(id),
  window_ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','day7_sent','day12_sent','converted','expired')),
  annual_price NUMERIC(12,2),
  already_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  upgrade_cost NUMERIC(12,2),
  converted_invoice_id UUID REFERENCES public.invoices(id),
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX upgrade_offers_status_window_idx ON public.upgrade_offers (status, window_ends_at);
CREATE INDEX upgrade_offers_branch_idx ON public.upgrade_offers (branch_id, status);
CREATE INDEX upgrade_offers_member_idx ON public.upgrade_offers (member_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.upgrade_offers TO authenticated;
GRANT ALL ON public.upgrade_offers TO service_role;

ALTER TABLE public.upgrade_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read branch upgrade offers"
  ON public.upgrade_offers FOR SELECT TO authenticated
  USING (branch_id IN (SELECT public.managed_branch_ids(auth.uid())));

CREATE POLICY "Staff manage branch upgrade offers"
  ON public.upgrade_offers FOR ALL TO authenticated
  USING (branch_id IN (SELECT public.managed_branch_ids(auth.uid())))
  WITH CHECK (branch_id IN (SELECT public.managed_branch_ids(auth.uid())));

CREATE POLICY "Members read own upgrade offer"
  ON public.upgrade_offers FOR SELECT TO authenticated
  USING ((SELECT public.is_own_member(member_id)));

-- Auto-create an offer when a short-term (30/90/180-day) membership is purchased.
CREATE OR REPLACE FUNCTION public.tg_create_upgrade_offer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan RECORD;
  v_annual RECORD;
BEGIN
  -- guard-exempt: trigger function, never called directly by users
  SELECT duration_days INTO v_plan FROM public.membership_plans WHERE id = NEW.plan_id;
  IF v_plan.duration_days IS NULL OR v_plan.duration_days NOT IN (30, 90, 180) THEN
    RETURN NEW;
  END IF;

  SELECT id, COALESCE(discounted_price, price) AS annual_price
    INTO v_annual
    FROM public.membership_plans
   WHERE branch_id = NEW.branch_id
     AND duration_days = 365
     AND is_active = true
   ORDER BY display_order NULLS LAST, created_at
   LIMIT 1;

  INSERT INTO public.upgrade_offers (
    branch_id, member_id, membership_id, target_plan_id,
    window_ends_at, annual_price, already_paid, upgrade_cost
  ) VALUES (
    NEW.branch_id, NEW.member_id, NEW.id, v_annual.id,
    (NEW.start_date + 15)::timestamptz,
    v_annual.annual_price,
    COALESCE(NEW.price_paid, 0),
    GREATEST(COALESCE(v_annual.annual_price, 0) - COALESCE(NEW.price_paid, 0), 0)
  )
  ON CONFLICT (membership_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_create_upgrade_offer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_create_upgrade_offer() TO service_role;

CREATE TRIGGER trg_memberships_upgrade_offer
  AFTER INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_create_upgrade_offer();

-- Financial breakdown for one member's upgrade window.
CREATE OR REPLACE FUNCTION public.calculate_upgrade_cost(p_member_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
  v_paid NUMERIC(12,2);
BEGIN
  IF public.rpc_guard_applies('calculate_upgrade_cost') THEN
    IF NOT (public.is_own_member(p_member_id) OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::text[])) THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT o.*, m.start_date, m.status AS membership_status
    INTO v_offer
    FROM public.upgrade_offers o
    JOIN public.memberships m ON m.id = o.membership_id
   WHERE o.member_id = p_member_id
     AND o.status IN ('pending','day7_sent','day12_sent')
   ORDER BY o.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_active_offer');
  END IF;

  IF v_offer.window_ends_at < now() OR v_offer.membership_status <> 'active' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'window_expired');
  END IF;

  -- Live paid total: completed payments against the source membership's invoices.
  SELECT COALESCE(SUM(p.amount), 0)
    INTO v_paid
    FROM public.payments p
    JOIN public.invoices i ON i.id = p.invoice_id
   WHERE i.member_id = p_member_id
     AND i.membership_id = v_offer.membership_id
     AND p.status = 'completed';

  v_paid := GREATEST(v_paid, COALESCE(v_offer.already_paid, 0));

  RETURN jsonb_build_object(
    'eligible', true,
    'offer_id', v_offer.id,
    'annual_price', v_offer.annual_price,
    'already_paid', v_paid,
    'upgrade_cost', GREATEST(COALESCE(v_offer.annual_price, 0) - v_paid, 0),
    'window_ends_at', v_offer.window_ends_at,
    'days_left', GREATEST((v_offer.window_ends_at::date - (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_upgrade_cost(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_upgrade_cost(UUID) TO service_role;

-- Atomic conversion after payment verification. Idempotent on p_invoice_id.
CREATE OR REPLACE FUNCTION public.convert_to_annual(p_offer_id UUID, p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer RECORD;
  v_new_end DATE;
BEGIN
  IF public.rpc_guard_applies('convert_to_annual') THEN
    PERFORM public.assert_branch_staff(
      (SELECT branch_id FROM public.upgrade_offers WHERE id = p_offer_id),
      false,
      'convert an upgrade offer'
    );
  END IF;

  SELECT * INTO v_offer FROM public.upgrade_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'offer_not_found');
  END IF;

  IF v_offer.status = 'converted' THEN
    IF v_offer.converted_invoice_id = p_invoice_id THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'membership_id', v_offer.membership_id);
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'already_converted');
  END IF;

  IF v_offer.status = 'expired' OR v_offer.window_ends_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'window_expired');
  END IF;

  -- Extend to 365 days from the ORIGINAL start date (inclusive), matching membershipEndDate math.
  UPDATE public.memberships m
     SET plan_id = COALESCE(v_offer.target_plan_id, m.plan_id),
         end_date = (m.start_date + 364)::date,
         original_end_date = (m.start_date + 364)::date,
         upgrade_credit_amount = COALESCE(v_offer.already_paid, 0),
         updated_at = now()
   WHERE m.id = v_offer.membership_id
  RETURNING end_date INTO v_new_end;

  UPDATE public.upgrade_offers
     SET status = 'converted',
         converted_invoice_id = p_invoice_id,
         converted_at = now(),
         updated_at = now()
   WHERE id = p_offer_id;

  INSERT INTO public.member_lifecycle_events (
    branch_id, member_id, entity_type, entity_id, event_type,
    previous_state, new_state, source, reason, idempotency_key, metadata
  ) VALUES (
    v_offer.branch_id, v_offer.member_id, 'membership', v_offer.membership_id,
    'annual_upgrade', 'short_term', 'annual', 'upgrade_window',
    '15-day upgrade window conversion',
    format('upgrade:%s:%s', p_offer_id, p_invoice_id),
    jsonb_build_object('offer_id', p_offer_id, 'invoice_id', p_invoice_id, 'new_end_date', v_new_end)
  ) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('success', true, 'membership_id', v_offer.membership_id, 'new_end_date', v_new_end);
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_to_annual(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_to_annual(UUID, UUID) TO service_role;

-- Branch-guarded summary for the admin dashboard widget (server-aggregated).
CREATE OR REPLACE FUNCTION public.upgrade_window_summary(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats JSONB;
  v_rows JSONB;
BEGIN
  PERFORM public.assert_branch_staff(p_branch_id, false, 'view upgrade window stats');

  SELECT jsonb_build_object(
    'in_window', COUNT(*) FILTER (WHERE status IN ('pending','day7_sent','day12_sent') AND window_ends_at >= now()),
    'sent_7d', COUNT(*) FILTER (WHERE status IN ('day7_sent','day12_sent','converted') AND updated_at >= now() - interval '7 days'),
    'converted_month', COUNT(*) FILTER (WHERE status = 'converted' AND converted_at >= date_trunc('month', now())),
    'conversion_revenue_month', COALESCE(SUM(upgrade_cost) FILTER (WHERE status = 'converted' AND converted_at >= date_trunc('month', now())), 0)
  ) INTO v_stats
  FROM public.upgrade_offers
  WHERE branch_id = p_branch_id;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT o.id, o.status, o.window_ends_at, o.upgrade_cost, o.annual_price, o.already_paid,
           o.converted_at,
           GREATEST(15 - ((o.window_ends_at::date - o.created_at::date)), 0) AS day_number,
           m.id AS member_id,
           COALESCE(p.full_name, 'Member') AS member_name,
           mp.name AS plan_name
      FROM public.upgrade_offers o
      JOIN public.members m ON m.id = o.member_id
      LEFT JOIN public.profiles p ON p.id = m.profile_id
      LEFT JOIN public.memberships ms ON ms.id = o.membership_id
      LEFT JOIN public.membership_plans mp ON mp.id = ms.plan_id
     WHERE o.branch_id = p_branch_id
       AND o.status IN ('pending','day7_sent','day12_sent','converted')
     ORDER BY (o.status = 'converted') ASC, o.window_ends_at ASC
     LIMIT 50
  ) t;

  RETURN jsonb_build_object('stats', v_stats, 'offers', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upgrade_window_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_window_summary(UUID) TO service_role;
