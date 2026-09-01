CREATE OR REPLACE FUNCTION public.purchase_membership(p_idempotency_key text, p_member_id uuid, p_plan_id uuid, p_branch_id uuid, p_start_date date, p_end_date date, p_price numeric, p_discount_amount numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_amount_paid numeric DEFAULT 0, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attempt_id uuid;
  v_membership_id uuid;
  v_invoice_id uuid;
  v_payment_result jsonb;
  v_total numeric;
  v_existing jsonb;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_status membership_status;
BEGIN
  SELECT result INTO v_existing
    FROM public.purchase_attempts
   WHERE idempotency_key = p_idempotency_key
     AND status = 'succeeded';
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_total := GREATEST(0, p_price - COALESCE(p_discount_amount, 0));
  v_status := CASE WHEN p_start_date > v_today
                   THEN 'pending'::membership_status
                   ELSE 'active'::membership_status END;

  INSERT INTO public.purchase_attempts
    (idempotency_key, branch_id, member_id, created_by)
  VALUES (p_idempotency_key, p_branch_id, p_member_id, auth.uid())
  ON CONFLICT (idempotency_key) DO UPDATE SET status='pending'
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.memberships(
    member_id, plan_id, branch_id, start_date, end_date,
    original_end_date, price_paid, discount_amount, discount_reason,
    notes, status, created_by
  ) VALUES (
    p_member_id, p_plan_id, p_branch_id, p_start_date, p_end_date,
    p_end_date, v_total, COALESCE(p_discount_amount,0), p_discount_reason,
    p_notes, v_status, auth.uid()
  ) RETURNING id INTO v_membership_id;

  INSERT INTO public.invoices(
    branch_id, member_id, status, subtotal, discount_amount,
    total_amount, amount_paid, invoice_type, created_by
  ) VALUES (
    p_branch_id, p_member_id, 'pending'::invoice_status,
    p_price, COALESCE(p_discount_amount,0), v_total, 0,
    'membership', auth.uid()
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items(
    invoice_id, description, quantity, unit_price, total_amount,
    reference_type, reference_id
  ) VALUES (
    v_invoice_id,
    'Membership: ' || COALESCE(
      (SELECT name FROM public.membership_plans WHERE id = p_plan_id), 'Plan'),
    1, v_total, v_total, 'membership', v_membership_id
  );

  IF COALESCE(p_amount_paid,0) > 0 THEN
    v_payment_result := public.record_payment(
      p_branch_id, v_invoice_id, p_member_id,
      p_amount_paid, p_payment_method, NULL,
      p_notes, auth.uid(), NULL
    );
  END IF;

  UPDATE public.purchase_attempts
     SET status = 'succeeded',
         result = jsonb_build_object(
           'membership_id', v_membership_id,
           'invoice_id', v_invoice_id,
           'status', v_status,
           'payment', v_payment_result
         ),
         updated_at = now()
   WHERE id = v_attempt_id;

  RETURN jsonb_build_object(
    'membership_id', v_membership_id,
    'invoice_id', v_invoice_id,
    'status', v_status,
    'payment', v_payment_result
  );
END;
$function$;

UPDATE public.memberships
   SET status = 'pending'::membership_status, updated_at = now()
 WHERE status = 'active'::membership_status
   AND start_date > (now() AT TIME ZONE 'Asia/Kolkata')::date;