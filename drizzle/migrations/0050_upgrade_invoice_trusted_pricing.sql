CREATE OR REPLACE FUNCTION public.create_upgrade_invoice(p_offer_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offer RECORD; v_calc JSONB; v_cost NUMERIC; v_sub NUMERIC; v_inv UUID; v_status text;
BEGIN
  SELECT * INTO v_offer FROM public.upgrade_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'offer_not_found'); END IF;
  IF v_offer.status IN ('converted','expired') OR v_offer.window_ends_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_eligible');
  END IF;
  v_calc := public.calculate_upgrade_cost(v_offer.member_id);
  IF NOT COALESCE((v_calc->>'eligible')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_eligible');
  END IF;
  v_cost := round((v_calc->>'upgrade_cost')::numeric, 2);
  IF v_cost < 1 THEN RETURN jsonb_build_object('success', false, 'error', 'nothing_to_pay'); END IF;

  IF v_offer.pending_invoice_id IS NOT NULL THEN
    SELECT status::text INTO v_status FROM public.invoices WHERE id = v_offer.pending_invoice_id
      AND total_amount = v_cost;
    IF v_status IN ('pending','draft','partial') THEN
      RETURN jsonb_build_object('success', true, 'invoice_id', v_offer.pending_invoice_id, 'amount', v_cost, 'branch_id', v_offer.branch_id, 'reused', true);
    END IF;
  END IF;

  -- Server-priced: let the member-pricing guard trust this insert.
  PERFORM set_config('app.trusted_invoice', 'true', true);
  v_sub := round(v_cost / 1.05, 2);
  INSERT INTO public.invoices (branch_id, member_id, invoice_number, status, subtotal, tax_amount, total_amount,
    amount_paid, due_date, notes, invoice_type, is_gst_invoice, gst_rate, source)
  VALUES (v_offer.branch_id, v_offer.member_id, NULL, 'pending', v_sub, v_cost - v_sub, v_cost,
    0, (v_offer.window_ends_at AT TIME ZONE 'Asia/Kolkata')::date,
    'Annual upgrade (15-day window) — prior payment adjusted', 'membership', true, 5, 'whatsapp_upgrade')
  RETURNING id INTO v_inv;
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount, reference_type, reference_id, hsn_code)
  VALUES (v_inv, 'Annual membership upgrade', 1, v_sub, 5, v_cost - v_sub, v_cost, 'upgrade_offer', p_offer_id, '999723');
  UPDATE public.upgrade_offers SET pending_invoice_id = v_inv, updated_at = now() WHERE id = p_offer_id;
  RETURN jsonb_build_object('success', true, 'invoice_id', v_inv, 'amount', v_cost, 'branch_id', v_offer.branch_id);
END; $$;
REVOKE EXECUTE ON FUNCTION public.create_upgrade_invoice(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_upgrade_invoice(UUID) TO service_role;