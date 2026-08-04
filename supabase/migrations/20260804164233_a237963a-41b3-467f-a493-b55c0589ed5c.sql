CREATE OR REPLACE FUNCTION public.recheck_invoice_reconciliation(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_inv record;
  v_paid numeric;
  v_reversed numeric;
  v_net_paid numeric;
  v_items_total numeric;
  v_item_count int;
  v_disc_pre numeric;
  v_rate numeric;
  v_gap numeric;
  v_findings text[] := ARRAY[]::text[];
BEGIN
  SELECT id, branch_id, status, amount_paid, total_amount, tax_amount, subtotal, discount_amount
    INTO v_inv
    FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;

  IF v_inv.status = 'cancelled'::invoice_status THEN
    PERFORM public.resolve_reconciliation_finding('invoice_drift', 'invoice', p_invoice_id);
    PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
    PERFORM public.resolve_reconciliation_finding('invoice_tax_drift', 'invoice', p_invoice_id);
    RETURN jsonb_build_object('found', true, 'skipped', 'cancelled');
  END IF;

  -- ---- payment ledger drift (net of reversals of still-counted payments) ----
  SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'completed'::payment_status), 0)
    INTO v_paid
    FROM public.payments p
   WHERE p.invoice_id = p_invoice_id;

  SELECT COALESCE(SUM(r.amount), 0)
    INTO v_reversed
    FROM public.payments r
    JOIN public.payments orig ON orig.id = r.reversal_of
   WHERE r.invoice_id = p_invoice_id
     AND orig.status = 'completed'::payment_status;

  v_net_paid := v_paid - v_reversed;

  IF ABS(v_net_paid - COALESCE(v_inv.amount_paid, 0)) > 0.01 THEN
    PERFORM public.upsert_reconciliation_finding(
      'invoice_drift', 'warn', v_inv.branch_id, 'invoice', p_invoice_id,
      jsonb_build_object('recorded', v_inv.amount_paid, 'actual', v_net_paid,
                         'delta', v_net_paid - COALESCE(v_inv.amount_paid, 0),
                         'gross_paid', v_paid, 'reversed', v_reversed));
    v_findings := v_findings || ARRAY['invoice_drift'];
  ELSE
    PERFORM public.resolve_reconciliation_finding('invoice_drift', 'invoice', p_invoice_id);
  END IF;

  -- ---- line item drift ----
  SELECT count(*), COALESCE(SUM(ii.total_amount), 0)
    INTO v_item_count, v_items_total
    FROM public.invoice_items ii
   WHERE ii.invoice_id = p_invoice_id;

  v_rate := CASE WHEN COALESCE(v_inv.subtotal, 0) > 0
                 THEN COALESCE(v_inv.tax_amount, 0) / v_inv.subtotal ELSE 0 END;
  v_disc_pre := COALESCE(v_inv.discount_amount, 0) / (1 + v_rate);

  IF v_item_count > 0 THEN
    -- Lines may be stored pre-tax or tax-inclusive; accept either, gross of discount
    v_gap := LEAST(
      ABS(v_items_total - (COALESCE(v_inv.subtotal, 0) + v_disc_pre)),
      ABS(v_items_total - (COALESCE(v_inv.total_amount, 0) + COALESCE(v_inv.discount_amount, 0)))
    );

    IF v_gap > 1.00 THEN
      PERFORM public.upsert_reconciliation_finding(
        'invoice_items_drift', 'warn', v_inv.branch_id, 'invoice', p_invoice_id,
        jsonb_build_object('items_total', v_items_total, 'subtotal', v_inv.subtotal,
                           'total_amount', v_inv.total_amount,
                           'discount_amount', v_inv.discount_amount,
                           'delta', v_gap, 'item_count', v_item_count));
      v_findings := v_findings || ARRAY['invoice_items_drift'];
    ELSE
      PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
    END IF;
  ELSE
    PERFORM public.resolve_reconciliation_finding('invoice_items_drift', 'invoice', p_invoice_id);
  END IF;

  -- ---- GST / tax drift: subtotal + tax must equal total, and rate must be a standard slab ----
  IF ABS(COALESCE(v_inv.subtotal, 0) + COALESCE(v_inv.tax_amount, 0) - COALESCE(v_inv.total_amount, 0)) > 0.05
     OR (COALESCE(v_inv.tax_amount, 0) > 0 AND ABS(v_rate * 100 - 5) > 0.3) THEN
    PERFORM public.upsert_reconciliation_finding(
      'invoice_tax_drift', 'warn', v_inv.branch_id, 'invoice', p_invoice_id,
      jsonb_build_object('subtotal', v_inv.subtotal, 'tax_amount', v_inv.tax_amount,
                         'total_amount', v_inv.total_amount,
                         'effective_rate', ROUND(v_rate * 100, 2),
                         'delta', COALESCE(v_inv.subtotal, 0) + COALESCE(v_inv.tax_amount, 0)
                                  - COALESCE(v_inv.total_amount, 0)));
    v_findings := v_findings || ARRAY['invoice_tax_drift'];
  ELSE
    PERFORM public.resolve_reconciliation_finding('invoice_tax_drift', 'invoice', p_invoice_id);
  END IF;

  RETURN jsonb_build_object('found', true, 'invoice_id', p_invoice_id,
                            'net_paid', v_net_paid, 'items_total', v_items_total,
                            'findings', to_jsonb(v_findings));
END;
$$;

SELECT public.recheck_invoice_reconciliation(id) FROM public.invoices;