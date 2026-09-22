-- 1) Online add-on purchase: hold as an unnumbered draft until payment lands
CREATE OR REPLACE FUNCTION public.purchase_benefit_credits(p_member_id uuid, p_membership_id uuid, p_package_id uuid, p_branch_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_idempotency_key text DEFAULT NULL::text, p_received_by uuid DEFAULT auth.uid(), p_defer_settlement boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_credit_id uuid;
  v_settle_result jsonb;
  v_expires_at timestamptz;
  v_rate numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
  v_fee_pct numeric := 0;
  v_fee numeric := 0;
BEGIN
  IF NOT p_defer_settlement
     AND COALESCE(p_payment_method, '') NOT IN ('cash','card','bank_transfer','wallet','upi','cheque','other') THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Unsupported payment method "%s" — use an online payment or a real settlement method.', p_payment_method));
  END IF;

  SELECT * INTO v_pkg FROM public.benefit_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  v_branch_id := COALESCE(p_branch_id, v_pkg.branch_id);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Branch missing');
  END IF;

  v_expires_at := now() + (v_pkg.validity_days || ' days')::interval;

  v_rate := COALESCE(v_pkg.tax_rate, 0) / 100.0;
  IF COALESCE(v_pkg.tax_inclusive, true) THEN
    v_total    := ROUND(v_pkg.price::numeric, 2);
    v_subtotal := ROUND(v_total / (1 + v_rate), 2);
    v_tax      := ROUND(v_total - v_subtotal, 2);
  ELSE
    v_subtotal := ROUND(v_pkg.price::numeric, 2);
    v_tax      := ROUND(v_subtotal * v_rate, 2);
    v_total    := ROUND(v_subtotal + v_tax, 2);
  END IF;

  IF p_defer_settlement THEN
    v_fee_pct := public.online_convenience_pct(v_branch_id);
    v_fee := ROUND(v_total * v_fee_pct / 100.0, 2);
  END IF;

  PERFORM set_config('app.trusted_invoice', 'true', true);

  INSERT INTO public.invoices (
    branch_id, member_id, subtotal, tax_amount, total_amount, amount_paid,
    status, due_date, payment_due_date, invoice_type, is_gst_invoice, gst_rate, notes
  ) VALUES (
    v_branch_id, p_member_id, v_subtotal + v_fee, v_tax, v_total + v_fee, 0,
    -- Online checkout: nothing is owed until the gateway confirms, so the bill
    -- stays an unnumbered draft with no due date (invisible to dues/gate logic).
    CASE WHEN p_defer_settlement THEN 'draft'::public.invoice_status
         ELSE 'pending'::public.invoice_status END,
    CASE WHEN p_defer_settlement THEN NULL ELSE CURRENT_DATE END,
    CASE WHEN p_defer_settlement THEN NULL ELSE CURRENT_DATE END,
    'benefit_addon',
    COALESCE(v_pkg.tax_rate, 0) > 0, COALESCE(v_pkg.tax_rate, 0),
    CASE WHEN p_defer_settlement
      THEN 'benefit_addon:' || p_package_id::text || ':' || COALESCE(p_membership_id::text, '')
      ELSE NULL END
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, unit_price, quantity, tax_rate, tax_amount, total_amount,
    hsn_code, reference_type, reference_id
  ) VALUES (
    v_invoice_id,
    format('Add-on: %s (%s credits)', v_pkg.name, v_pkg.quantity),
    v_subtotal, 1, COALESCE(v_pkg.tax_rate, 0), v_tax, v_subtotal,
    v_pkg.hsn_code, 'benefit_package', p_package_id
  );

  IF v_fee > 0 THEN
    INSERT INTO public.invoice_items (
      invoice_id, description, unit_price, quantity, tax_rate, tax_amount, total_amount,
      reference_type, reference_id
    ) VALUES (
      v_invoice_id,
      format('Online payment convenience charge (%s%%)', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM v_fee_pct::text))),
      v_fee, 1, 0, 0, v_fee,
      'convenience_fee', p_package_id
    );
  END IF;

  IF p_defer_settlement THEN
    PERFORM set_config('app.trusted_invoice', 'false', true);
    RETURN jsonb_build_object(
      'success', true, 'deferred', true, 'invoice_id', v_invoice_id,
      'amount', v_total + v_fee, 'subtotal', v_subtotal, 'tax_amount', v_tax,
      'convenience_fee', v_fee, 'convenience_pct', v_fee_pct
    );
  END IF;

  BEGIN
    INSERT INTO public.member_benefit_credits (
      member_id, membership_id, benefit_type, benefit_type_id, package_id,
      credits_total, credits_remaining, expires_at, invoice_id
    ) VALUES (
      p_member_id, p_membership_id, v_pkg.benefit_type, v_pkg.benefit_type_id, p_package_id,
      v_pkg.quantity, v_pkg.quantity, v_expires_at, v_invoice_id
    ) RETURNING id INTO v_credit_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'benefit_credits_insert_failed: %', SQLERRM;
  END;

  v_settle_result := public.settle_payment(
    v_branch_id, v_invoice_id, p_member_id, v_total, p_payment_method,
    NULL, NULL, p_received_by, NULL, 'benefit_addon', p_idempotency_key, NULL, NULL,
    jsonb_build_object('package_id', p_package_id, 'membership_id', p_membership_id, 'credit_id', v_credit_id)
  );

  PERFORM set_config('app.trusted_invoice', 'false', true);

  IF COALESCE((v_settle_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'settle_payment_failed: %', COALESCE(v_settle_result->>'error','unknown');
  END IF;

  RETURN jsonb_build_object('success', true, 'credit_id', v_credit_id, 'invoice_id', v_invoice_id,
    'amount', v_total, 'subtotal', v_subtotal, 'tax_amount', v_tax);
END;
$function$;

-- 2) Draft invoices must not consume a number on insert
DROP TRIGGER IF EXISTS generate_invoice_number_trigger ON public.invoices;
CREATE TRIGGER generate_invoice_number_trigger
BEFORE INSERT ON public.invoices
FOR EACH ROW
WHEN (
  (NEW.invoice_number IS NULL OR NEW.invoice_number = '')
  AND NEW.status IS DISTINCT FROM 'draft'::public.invoice_status
)
EXECUTE FUNCTION public.generate_invoice_number();

-- Number + date the bill the moment it leaves draft (i.e. when money lands)
CREATE OR REPLACE FUNCTION public.tg_finalize_draft_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF OLD.status = 'draft'::public.invoice_status
     AND NEW.status IS DISTINCT FROM 'draft'::public.invoice_status
     AND NEW.status <> 'cancelled'::public.invoice_status THEN
    IF COALESCE(NEW.invoice_number, '') = '' THEN
      NEW := public.generate_invoice_number_for(NEW);
    END IF;
    NEW.due_date := COALESCE(NEW.due_date, CURRENT_DATE);
    NEW.payment_due_date := COALESCE(NEW.payment_due_date, CURRENT_DATE);
  END IF;
  RETURN NEW;
END;
$function$;

-- Shared numbering helper so both the insert trigger and the finalizer agree
CREATE OR REPLACE FUNCTION public.generate_invoice_number_for(_inv public.invoices)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_branch_code TEXT;
  v_yy          TEXT;
  v_seq         INTEGER;
  v_series      TEXT;
BEGIN
  SELECT code INTO v_branch_code FROM public.branches WHERE id = _inv.branch_id;
  IF v_branch_code IS NULL THEN
    v_branch_code := 'X';
  END IF;
  v_yy := TO_CHAR(CURRENT_DATE, 'YY');

  v_series := CASE
    WHEN COALESCE(_inv.is_proforma, false) THEN 'PRO'
    WHEN COALESCE(_inv.is_gst_invoice, false) THEN 'INV'
    ELSE 'BOS'
  END;

  INSERT INTO public.invoice_number_counters (branch_id, year_yy, series, last_seq)
  VALUES (_inv.branch_id, v_yy, v_series, 1)
  ON CONFLICT (branch_id, year_yy, series) DO UPDATE
    SET last_seq = public.invoice_number_counters.last_seq + 1,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  _inv.document_series := v_series;
  _inv.invoice_number := v_series || '-' || v_branch_code || '-' || v_yy || '-' || LPAD(v_seq::text, 4, '0');
  RETURN _inv;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.generate_invoice_number_for(public.invoices) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_finalize_draft_invoice() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_finalize_draft_invoice ON public.invoices;
CREATE TRIGGER trg_finalize_draft_invoice
BEFORE UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.tg_finalize_draft_invoice();

-- 3) No "new invoice" notification for an unfinished draft
CREATE OR REPLACE FUNCTION public.tg_notify_member_on_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW.member_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'draft'::public.invoice_status THEN RETURN NEW; END IF;
  SELECT user_id INTO v_user_id FROM public.members WHERE id = NEW.member_id;
  IF v_user_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.notify_member(
    v_user_id,
    NEW.branch_id,
    'New invoice generated',
    'Invoice ' || COALESCE(NEW.invoice_number, '') || ' for ₹' || COALESCE(NEW.total_amount, 0)::text,
    'info',
    'billing'
  );
  RETURN NEW;
END;
$function$;

-- 4) Abandon accepts drafts too
CREATE OR REPLACE FUNCTION public.abandon_online_addon_invoice(_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv RECORD;
BEGIN
  SELECT i.id, i.status, i.amount_paid, i.invoice_type, i.member_id
    INTO v_inv
  FROM public.invoices i
  WHERE i.id = _invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF v_inv.invoice_type <> 'benefit_addon'
     OR COALESCE(v_inv.amount_paid, 0) > 0
     OR v_inv.status NOT IN ('pending'::public.invoice_status, 'draft'::public.invoice_status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an unpaid add-on invoice can be abandoned');
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.members m WHERE m.id = v_inv.member_id AND m.user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[])
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not allowed');
  END IF;

  DELETE FROM public.invoice_items WHERE invoice_id = _invoice_id;
  DELETE FROM public.invoices WHERE id = _invoice_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5) Backstop cleanup for drafts abandoned mid-checkout
CREATE OR REPLACE FUNCTION public.reap_abandoned_addon_invoices(_older_than_minutes integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(i.id) INTO v_ids
  FROM public.invoices i
  WHERE i.invoice_type = 'benefit_addon'
    AND i.status = 'draft'::public.invoice_status
    AND COALESCE(i.amount_paid, 0) = 0
    AND i.created_at < now() - make_interval(mins => GREATEST(COALESCE(_older_than_minutes, 30), 5))
    AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = i.id);

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('success', true, 'deleted', 0);
  END IF;

  DELETE FROM public.invoice_items WHERE invoice_id = ANY(v_ids);
  DELETE FROM public.invoices WHERE id = ANY(v_ids);

  RETURN jsonb_build_object('success', true, 'deleted', array_length(v_ids, 1));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reap_abandoned_addon_invoices(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_abandoned_addon_invoices(integer) TO service_role;