-- 1) Member visibility for add-on packages
DROP POLICY IF EXISTS "View active benefit packages in scope" ON public.benefit_packages;
CREATE POLICY "View active benefit packages in scope"
ON public.benefit_packages FOR SELECT TO authenticated
USING (
  is_active = true
  AND (
    branch_id IS NULL
    OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    OR branch_id IN (SELECT m.branch_id FROM public.members m WHERE m.user_id = auth.uid())
  )
);

-- 2) Safety notes & terms on benefit types
ALTER TABLE public.benefit_types
  ADD COLUMN IF NOT EXISTS safety_notes text,
  ADD COLUMN IF NOT EXISTS terms text;

-- 3) GST-aware add-on purchase
CREATE OR REPLACE FUNCTION public.purchase_benefit_credits(
  p_member_id uuid,
  p_membership_id uuid,
  p_package_id uuid,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_payment_method text DEFAULT 'cash'::text,
  p_idempotency_key text DEFAULT NULL::text,
  p_received_by uuid DEFAULT auth.uid()
)
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
BEGIN
  SELECT * INTO v_pkg FROM public.benefit_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  v_branch_id := COALESCE(p_branch_id, v_pkg.branch_id);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Branch missing');
  END IF;

  v_expires_at := now() + (v_pkg.validity_days || ' days')::interval;

  -- Tax split: price is what the member was quoted.
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

  INSERT INTO public.invoices (
    branch_id, member_id, subtotal, tax_amount, total_amount, amount_paid,
    status, due_date, invoice_type, is_gst_invoice, gst_rate
  ) VALUES (
    v_branch_id, p_member_id, v_subtotal, v_tax, v_total, 0,
    'pending'::public.invoice_status, CURRENT_DATE, 'benefit_addon',
    COALESCE(v_pkg.tax_rate, 0) > 0, COALESCE(v_pkg.tax_rate, 0)
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, unit_price, quantity, tax_rate, tax_amount, total_amount,
    hsn_code, reference_type, reference_id
  ) VALUES (
    v_invoice_id,
    format('Add-on: %s (%s credits)', v_pkg.name, v_pkg.quantity),
    v_subtotal, 1, COALESCE(v_pkg.tax_rate, 0), v_tax, v_subtotal,
    v_pkg.hsn_code, 'benefit_addon', p_package_id
  );

  BEGIN
    INSERT INTO public.member_benefit_credits (
      member_id, membership_id, benefit_type, package_id,
      credits_total, credits_remaining, expires_at, invoice_id
    ) VALUES (
      p_member_id, p_membership_id, v_pkg.benefit_type, p_package_id,
      v_pkg.quantity, v_pkg.quantity, v_expires_at, v_invoice_id
    ) RETURNING id INTO v_credit_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'benefit_credits_insert_failed: %', SQLERRM;
  END;

  v_settle_result := public.settle_payment(
    v_branch_id,
    v_invoice_id,
    p_member_id,
    v_total,
    p_payment_method,
    NULL, NULL, p_received_by, NULL,
    'benefit_addon',
    p_idempotency_key,
    NULL, NULL,
    jsonb_build_object('package_id', p_package_id, 'membership_id', p_membership_id, 'credit_id', v_credit_id)
  );

  IF COALESCE((v_settle_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'settle_payment_failed: %', COALESCE(v_settle_result->>'error','unknown');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'credit_id', v_credit_id,
    'invoice_id', v_invoice_id,
    'amount', v_total,
    'subtotal', v_subtotal,
    'tax_amount', v_tax
  );
END;
$function$;