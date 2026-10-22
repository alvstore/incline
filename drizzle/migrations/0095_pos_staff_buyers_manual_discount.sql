ALTER TABLE public.pos_sales
  ADD COLUMN IF NOT EXISTS buyer_type text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS staff_user_id uuid,
  ADD COLUMN IF NOT EXISTS original_amount numeric,
  ADD COLUMN IF NOT EXISTS manual_discount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text,
  ADD COLUMN IF NOT EXISTS discount_by uuid,
  ADD COLUMN IF NOT EXISTS settlement text,
  ADD COLUMN IF NOT EXISTS salary_advance_id uuid;

CREATE INDEX IF NOT EXISTS pos_sales_manual_discount_idx ON public.pos_sales (branch_id, sale_date DESC) WHERE manual_discount > 0 OR settlement IN ('due','salary_deduction');

-- Team members (staff + trainers) of a branch that can be chosen as a counter-sale buyer.
CREATE OR REPLACE FUNCTION public.search_pos_staff_buyers(p_branch_id uuid, p_term text)
RETURNS TABLE(user_id uuid, full_name text, phone text, code text, kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_t text := lower(trim(coalesce(p_term,'')));
BEGIN
  IF public.rpc_guard_applies('search_pos_staff_buyers') THEN
    PERFORM public.assert_branch_staff(p_branch_id, false, 'search staff buyers');
  END IF;
  IF length(v_t) < 2 THEN RETURN; END IF;
  RETURN QUERY
  SELECT DISTINCT ON (x.user_id) x.user_id, x.full_name, x.phone, x.code, x.kind FROM (
    SELECT e.user_id, p.full_name, p.phone, e.employee_code AS code,
           CASE WHEN t.user_id IS NOT NULL THEN 'trainer' ELSE 'staff' END AS kind, 0 AS pri
      FROM public.employees e JOIN public.profiles p ON p.id = e.user_id
      LEFT JOIN public.trainers t ON t.user_id = e.user_id AND COALESCE(t.is_active, true)
     WHERE e.branch_id = p_branch_id AND COALESCE(e.is_active, true)
    UNION ALL
    SELECT t.user_id, p.full_name, p.phone, t.trainer_code, 'trainer', 1
      FROM public.trainers t JOIN public.profiles p ON p.id = t.user_id
     WHERE t.branch_id = p_branch_id AND COALESCE(t.is_active, true)
  ) x
  WHERE lower(coalesce(x.full_name,'')) LIKE '%'||v_t||'%'
     OR coalesce(x.phone,'') LIKE '%'||v_t||'%'
     OR lower(coalesce(x.code,'')) LIKE '%'||v_t||'%'
  ORDER BY x.user_id, x.pri
  LIMIT 10;
END $$;
REVOKE ALL ON FUNCTION public.search_pos_staff_buyers(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_pos_staff_buyers(uuid,text) TO authenticated, service_role;

-- Desk checkout with staff buyers, audited manual discount and settlement modes.
CREATE OR REPLACE FUNCTION public.create_pos_sale_audited(
  p_branch_id uuid, p_member_id uuid, p_items jsonb, p_payment_method text,
  p_settlement text DEFAULT 'paid',            -- paid | link | due | salary_deduction
  p_buyer_type text DEFAULT 'member',          -- member | staff | walk_in
  p_staff_user_id uuid DEFAULT NULL,
  p_guest_name text DEFAULT NULL, p_guest_phone text DEFAULT NULL, p_guest_email text DEFAULT NULL,
  p_coupon_discount numeric DEFAULT 0, p_discount_code_id uuid DEFAULT NULL, p_discount_code text DEFAULT NULL,
  p_manual_discount numeric DEFAULT 0, p_discount_reason text DEFAULT NULL,
  p_wallet_applied numeric DEFAULT 0, p_transaction_id text DEFAULT NULL, p_slip_url text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_mgr boolean;
  v_subtotal numeric := 0;
  v_manual numeric := round(GREATEST(0, COALESCE(p_manual_discount,0)), 2);
  v_coupon numeric := GREATEST(0, COALESCE(p_coupon_discount,0));
  v_max_pct numeric := 10;
  v_res jsonb;
  v_name text; v_phone text; v_email text;
  v_member uuid := p_member_id;
  v_adv uuid;
  v_inv_no text;
BEGIN
  IF p_settlement NOT IN ('paid','link','due','salary_deduction') THEN RAISE EXCEPTION 'Unknown payment option'; END IF;
  IF p_buyer_type NOT IN ('member','staff','walk_in') THEN RAISE EXCEPTION 'Unknown buyer type'; END IF;
  IF public.rpc_guard_applies('create_pos_sale_audited') THEN
    PERFORM public.assert_branch_staff(p_branch_id, true, 'POS sale');
  END IF;
  v_is_mgr := public.has_any_role(v_uid, ARRAY['owner','admin','manager']::text[]);

  SELECT COALESCE(SUM(COALESCE((e->>'total')::numeric,0)),0) INTO v_subtotal FROM jsonb_array_elements(p_items) e;

  IF p_buyer_type = 'staff' THEN
    IF p_staff_user_id IS NULL THEN RAISE EXCEPTION 'Choose the team member who is buying'; END IF;
    SELECT p.full_name, p.phone, p.email INTO v_name, v_phone, v_email FROM public.profiles p WHERE p.id = p_staff_user_id;
    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE user_id = p_staff_user_id AND branch_id = p_branch_id)
       AND NOT EXISTS (SELECT 1 FROM public.trainers WHERE user_id = p_staff_user_id AND branch_id = p_branch_id) THEN
      RAISE EXCEPTION 'This team member does not belong to this branch';
    END IF;
    v_member := NULL;
  ELSE
    IF p_settlement = 'salary_deduction' THEN RAISE EXCEPTION 'Salary deduction is only for staff and trainers'; END IF;
    v_name := p_guest_name; v_phone := p_guest_phone; v_email := p_guest_email;
  END IF;

  IF v_manual > 0 THEN
    IF NULLIF(trim(COALESCE(p_discount_reason,'')),'') IS NULL THEN RAISE EXCEPTION 'Give a reason for the discount'; END IF;
    IF v_manual + v_coupon > v_subtotal THEN RAISE EXCEPTION 'Discount is more than the bill'; END IF;
    IF p_staff_user_id = v_uid AND NOT public.has_any_role(v_uid, ARRAY['owner','admin']::text[]) THEN
      RAISE EXCEPTION 'You cannot give yourself a discount. Ask another manager or the owner to ring up this sale.' USING ERRCODE='42501';
    END IF;
    IF NOT v_is_mgr THEN
      SELECT COALESCE(NULLIF(value::text,'')::numeric, 10) INTO v_max_pct FROM public.settings
       WHERE key = 'pos_staff_max_discount_pct' AND (branch_id = p_branch_id OR branch_id IS NULL)
       ORDER BY branch_id NULLS LAST LIMIT 1;
      v_max_pct := COALESCE(v_max_pct, 10);
      IF v_subtotal > 0 AND v_manual * 100 / v_subtotal > v_max_pct THEN
        RAISE EXCEPTION 'Discounts above % percent need a manager. Ask a manager to complete this sale.', v_max_pct USING ERRCODE='42501';
      END IF;
    END IF;
  END IF;

  v_res := public.create_pos_sale(
    p_branch_id := p_branch_id, p_member_id := v_member, p_items := p_items,
    p_payment_method := CASE WHEN p_settlement = 'salary_deduction' THEN 'other' ELSE COALESCE(p_payment_method,'cash') END,
    p_sold_by := v_uid,
    p_guest_name := CASE WHEN v_member IS NULL THEN v_name END,
    p_guest_phone := CASE WHEN v_member IS NULL THEN v_phone END,
    p_guest_email := CASE WHEN v_member IS NULL THEN v_email END,
    p_awaiting_payment := p_settlement IN ('link','due'),
    p_discount_amount := v_coupon + v_manual,
    p_discount_code_id := p_discount_code_id, p_discount_code := p_discount_code,
    p_wallet_applied := CASE WHEN v_member IS NULL THEN 0 ELSE COALESCE(p_wallet_applied,0) END,
    p_transaction_id := CASE WHEN p_settlement = 'salary_deduction' THEN 'SALARY-DEDUCTION' ELSE p_transaction_id END,
    p_slip_url := p_slip_url, p_idempotency_key := p_idempotency_key);

  IF p_settlement = 'salary_deduction' AND COALESCE((v_res->>'total')::numeric,0) > 0 THEN
    SELECT invoice_number INTO v_inv_no FROM public.invoices WHERE id = (v_res->>'invoice_id')::uuid;
    INSERT INTO public.salary_advances (branch_id, user_id, amount, outstanding, payment_method, payment_reference, reason, auto_recover, created_by)
    VALUES (p_branch_id, p_staff_user_id, (v_res->>'total')::numeric, (v_res->>'total')::numeric, 'other', v_inv_no,
            'Store purchase – ' || COALESCE(v_inv_no, 'POS sale'), true, v_uid)
    RETURNING id INTO v_adv;
  END IF;

  UPDATE public.pos_sales SET
    buyer_type = p_buyer_type, staff_user_id = p_staff_user_id,
    original_amount = v_subtotal, manual_discount = v_manual,
    discount_reason = CASE WHEN v_manual > 0 THEN trim(p_discount_reason) END,
    discount_by = CASE WHEN v_manual > 0 THEN v_uid END,
    settlement = p_settlement, salary_advance_id = v_adv
  WHERE id = (v_res->>'pos_sale_id')::uuid;

  IF v_manual > 0 OR p_settlement IN ('due','salary_deduction') THEN
    INSERT INTO public.audit_logs (action, table_name, record_id, user_id, branch_id, new_data)
    VALUES ('pos_sale_exception', 'pos_sales', (v_res->>'pos_sale_id')::uuid, v_uid, p_branch_id,
      jsonb_build_object('buyer_type', p_buyer_type, 'buyer', v_name, 'staff_user_id', p_staff_user_id,
        'original_amount', v_subtotal, 'manual_discount', v_manual, 'coupon_discount', v_coupon,
        'reason', p_discount_reason, 'settlement', p_settlement, 'total', v_res->'total',
        'invoice_number', v_inv_no, 'salary_advance_id', v_adv));
  END IF;

  RETURN v_res || jsonb_build_object('manual_discount', v_manual, 'settlement', p_settlement, 'salary_advance_id', v_adv);
END $$;
REVOKE ALL ON FUNCTION public.create_pos_sale_audited(uuid,uuid,jsonb,text,text,text,uuid,text,text,text,numeric,uuid,text,numeric,text,numeric,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pos_sale_audited(uuid,uuid,jsonb,text,text,text,uuid,text,text,text,numeric,uuid,text,numeric,text,numeric,text,text,text) TO authenticated, service_role;