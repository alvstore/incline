-- 1) Always stamp the signed-in person on sales/payments
CREATE OR REPLACE FUNCTION public.tg_stamp_actor()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN ('memberships','invoices') THEN
    IF NEW.created_by IS NULL THEN NEW.created_by := v_uid; END IF;
  ELSIF TG_TABLE_NAME = 'payments' THEN
    IF NEW.received_by IS NULL THEN NEW.received_by := v_uid; END IF;
  ELSIF TG_TABLE_NAME = 'pos_sales' THEN
    IF NEW.sold_by IS NULL THEN NEW.sold_by := v_uid; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_stamp_actor() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_stamp_actor_memberships ON public.memberships;
CREATE TRIGGER tg_stamp_actor_memberships BEFORE INSERT ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_actor();
DROP TRIGGER IF EXISTS tg_stamp_actor_invoices ON public.invoices;
CREATE TRIGGER tg_stamp_actor_invoices BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_actor();
DROP TRIGGER IF EXISTS tg_stamp_actor_payments ON public.payments;
CREATE TRIGGER tg_stamp_actor_payments BEFORE INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_actor();
DROP TRIGGER IF EXISTS tg_stamp_actor_pos_sales ON public.pos_sales;
CREATE TRIGGER tg_stamp_actor_pos_sales BEFORE INSERT ON public.pos_sales FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_actor();

-- 2) Backfill missing names from the audit trail (only where empty)
UPDATE public.memberships m SET created_by = a.user_id
FROM (SELECT DISTINCT ON (record_id) record_id, user_id FROM public.audit_logs
      WHERE table_name='memberships' AND action='INSERT' AND user_id IS NOT NULL ORDER BY record_id, created_at) a
WHERE m.created_by IS NULL AND a.record_id = m.id;
UPDATE public.invoices i SET created_by = a.user_id
FROM (SELECT DISTINCT ON (record_id) record_id, user_id FROM public.audit_logs
      WHERE table_name='invoices' AND action='INSERT' AND user_id IS NOT NULL ORDER BY record_id, created_at) a
WHERE i.created_by IS NULL AND a.record_id = i.id;
UPDATE public.payments p SET received_by = a.user_id
FROM (SELECT DISTINCT ON (record_id) record_id, user_id FROM public.audit_logs
      WHERE table_name='payments' AND action='INSERT' AND user_id IS NOT NULL ORDER BY record_id, created_at) a
WHERE p.received_by IS NULL AND a.record_id = p.id;

-- 3) Store sale: no staff discount cap; above-limit discounts are flagged in the audit
CREATE OR REPLACE FUNCTION public.create_pos_sale_audited(p_branch_id uuid, p_member_id uuid, p_items jsonb, p_payment_method text, p_settlement text DEFAULT 'paid'::text, p_buyer_type text DEFAULT 'member'::text, p_staff_user_id uuid DEFAULT NULL::uuid, p_guest_name text DEFAULT NULL::text, p_guest_phone text DEFAULT NULL::text, p_guest_email text DEFAULT NULL::text, p_coupon_discount numeric DEFAULT 0, p_discount_code_id uuid DEFAULT NULL::uuid, p_discount_code text DEFAULT NULL::text, p_manual_discount numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_wallet_applied numeric DEFAULT 0, p_transaction_id text DEFAULT NULL::text, p_slip_url text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_subtotal numeric := 0;
  v_manual numeric := round(GREATEST(0, COALESCE(p_manual_discount,0)), 2);
  v_coupon numeric := GREATEST(0, COALESCE(p_coupon_discount,0));
  v_flag_pct numeric := 10;
  v_pct numeric := 0;
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
    SELECT COALESCE(NULLIF(value::text,'')::numeric, 10) INTO v_flag_pct FROM public.settings
     WHERE key = 'pos_staff_max_discount_pct' AND (branch_id = p_branch_id OR branch_id IS NULL)
     ORDER BY branch_id NULLS LAST LIMIT 1;
    v_flag_pct := COALESCE(v_flag_pct, 10);
    IF v_subtotal > 0 THEN v_pct := round(v_manual * 100 / v_subtotal, 2); END IF;
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
    INSERT INTO public.salary_advances (source, branch_id, user_id, amount, outstanding, payment_method, payment_reference, reason, auto_recover, created_by)
    VALUES ('pos', p_branch_id, p_staff_user_id, (v_res->>'total')::numeric, (v_res->>'total')::numeric, 'other', v_inv_no,
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
        'original_amount', v_subtotal, 'manual_discount', v_manual, 'discount_pct', v_pct,
        'high_discount', v_pct > v_flag_pct, 'coupon_discount', v_coupon,
        'reason', p_discount_reason, 'settlement', p_settlement, 'total', v_res->'total',
        'invoice_number', v_inv_no, 'salary_advance_id', v_adv));
  END IF;

  RETURN v_res || jsonb_build_object('manual_discount', v_manual, 'discount_pct', v_pct, 'high_discount', v_pct > v_flag_pct, 'settlement', p_settlement, 'salary_advance_id', v_adv);
END $function$;
