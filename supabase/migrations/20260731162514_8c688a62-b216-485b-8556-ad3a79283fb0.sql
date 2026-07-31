CREATE OR REPLACE FUNCTION public.record_payment(
  p_branch_id uuid,
  p_invoice_id uuid,
  p_member_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date timestamptz,
  p_transaction_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_received_by uuid DEFAULT NULL,
  p_income_category_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_result jsonb;
  v_payment_id uuid;
  v_date timestamptz := COALESCE(p_payment_date, now());
BEGIN
  IF v_date > now() + interval '1 minute' THEN
    RAISE EXCEPTION 'PAYMENT_DATE_IN_FUTURE' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.settle_payment(
    p_branch_id, p_invoice_id, p_member_id, p_amount, p_payment_method,
    p_transaction_id, p_notes, p_received_by, p_income_category_id,
    'manual', NULL, NULL, NULL, jsonb_build_object('backdated', v_date <> now())
  );

  v_payment_id := NULLIF(v_result->>'payment_id','')::uuid;
  IF v_payment_id IS NOT NULL AND p_payment_date IS NOT NULL THEN
    UPDATE public.payments
       SET payment_date = v_date,
           settled_at = COALESCE(settled_at, v_date)
     WHERE id = v_payment_id;
  END IF;

  RETURN v_result || jsonb_build_object('payment_date', v_date);
END; $function$;

GRANT EXECUTE ON FUNCTION public.record_payment(uuid,uuid,uuid,numeric,text,timestamptz,text,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid,uuid,uuid,numeric,text,timestamptz,text,text,uuid,uuid) TO service_role;