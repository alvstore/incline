-- 1) Locker billing: invoices.subtotal is NOT NULL with no default.
CREATE OR REPLACE FUNCTION public.assign_locker_with_billing(p_locker_id uuid, p_member_id uuid, p_start_date date, p_end_date date, p_fee_amount numeric, p_billing_months integer DEFAULT 1, p_chargeable boolean DEFAULT true, p_gst_rate numeric DEFAULT NULL::numeric, p_received_by uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_locker record; v_assignment_id uuid; v_invoice_id uuid := NULL;
  v_invoice_item_id uuid; v_branch_id uuid; v_total numeric;
  v_gst_rate numeric; v_gst record; v_item_label text;
BEGIN
  SELECT * INTO v_locker FROM public.lockers WHERE id = p_locker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOCKER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_locker.status <> 'available' THEN
    RAISE EXCEPTION 'LOCKER_TAKEN: locker % is %', v_locker.locker_number, v_locker.status USING ERRCODE = 'P0001';
  END IF;
  v_branch_id := v_locker.branch_id;

  INSERT INTO public.locker_assignments (locker_id, member_id, start_date, end_date, fee_amount, is_active)
  VALUES (p_locker_id, p_member_id, p_start_date, p_end_date, p_fee_amount, true)
  RETURNING id INTO v_assignment_id;

  UPDATE public.lockers SET status = 'assigned', updated_at = now() WHERE id = p_locker_id;

  IF p_chargeable AND COALESCE(p_fee_amount,0) > 0 THEN
    v_total := round(p_fee_amount * COALESCE(p_billing_months,1), 2);
    v_gst_rate := COALESCE(p_gst_rate, public.resolve_gst_rate('locker', p_locker_id, v_branch_id));
    SELECT * INTO v_gst FROM public.calc_gst(v_total, v_gst_rate, false, true);
    INSERT INTO public.invoices (member_id, branch_id, subtotal, tax_amount, discount_amount, total_amount, amount_paid, status, due_date, created_by)
    VALUES (p_member_id, v_branch_id, v_gst.taxable, v_gst.cgst + v_gst.sgst + v_gst.igst, 0, v_gst.total, 0, 'pending', p_end_date, p_received_by)
    RETURNING id INTO v_invoice_id;

    v_item_label := 'Locker ' || v_locker.locker_number
      || ' (' || to_char(p_start_date, 'DD Mon YYYY') || ' - ' || to_char(p_end_date, 'DD Mon YYYY') || ')';

    INSERT INTO public.invoice_items (invoice_id, item_type, item_name, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_invoice_id, 'locker', v_item_label, 1, v_gst.taxable, v_gst_rate, v_gst.cgst + v_gst.sgst + v_gst.igst, v_gst.total)
    RETURNING id INTO v_invoice_item_id;
  END IF;

  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'invoice_id', v_invoice_id, 'locker_id', p_locker_id, 'branch_id', v_branch_id);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event('error','database', SQLERRM, 'assign_locker_with_billing', NULL,'lockers', v_branch_id, p_received_by, NULL, NULL, NULL,
    jsonb_build_object('locker_id',p_locker_id,'member_id',p_member_id));
  RAISE;
END; $function$;

CREATE OR REPLACE FUNCTION public.assign_locker_with_billing(p_locker_id uuid, p_member_id uuid, p_start_date date, p_end_date date, p_fee_amount numeric, p_billing_months integer DEFAULT 1, p_chargeable boolean DEFAULT true, p_gst_rate numeric DEFAULT NULL::numeric, p_received_by uuid DEFAULT NULL::uuid, p_assign_source text DEFAULT 'addon'::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_locker record; v_assignment_id uuid; v_invoice_id uuid := NULL;
  v_invoice_item_id uuid; v_branch_id uuid; v_total numeric;
  v_gst_rate numeric; v_gst record;
  v_effective_end_date date; v_membership_end date; v_chargeable boolean;
  v_item_label text;
BEGIN
  SELECT * INTO v_locker FROM public.lockers WHERE id = p_locker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOCKER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_locker.status <> 'available' THEN
    RAISE EXCEPTION 'LOCKER_TAKEN: locker % is %', v_locker.locker_number, v_locker.status USING ERRCODE = 'P0001';
  END IF;
  v_branch_id := v_locker.branch_id;
  v_effective_end_date := p_end_date;
  v_chargeable := p_chargeable;

  IF p_assign_source = 'plan' THEN
    SELECT m.end_date INTO v_membership_end
    FROM public.memberships m
    WHERE m.member_id = p_member_id AND m.status = 'active' AND m.end_date >= p_start_date
    ORDER BY m.end_date DESC LIMIT 1;
    IF v_membership_end IS NOT NULL THEN v_effective_end_date := v_membership_end; END IF;
    v_chargeable := false;
  END IF;

  INSERT INTO public.locker_assignments (locker_id, member_id, start_date, end_date, fee_amount, is_active)
  VALUES (p_locker_id, p_member_id, p_start_date, v_effective_end_date,
          CASE WHEN v_chargeable THEN p_fee_amount ELSE 0 END, true)
  RETURNING id INTO v_assignment_id;

  UPDATE public.lockers SET status = 'assigned', updated_at = now() WHERE id = p_locker_id;

  IF v_chargeable AND COALESCE(p_fee_amount,0) > 0 THEN
    v_total := round(p_fee_amount * COALESCE(p_billing_months,1), 2);
    v_gst_rate := COALESCE(p_gst_rate, public.resolve_gst_rate('locker', p_locker_id, v_branch_id));
    SELECT * INTO v_gst FROM public.calc_gst(v_total, v_gst_rate, false, true);
    INSERT INTO public.invoices (member_id, branch_id, subtotal, tax_amount, discount_amount, total_amount, amount_paid, status, due_date, created_by)
    VALUES (p_member_id, v_branch_id, v_gst.taxable, v_gst.cgst + v_gst.sgst + v_gst.igst, 0, v_gst.total, 0, 'pending', v_effective_end_date, p_received_by)
    RETURNING id INTO v_invoice_id;

    v_item_label := 'Locker ' || v_locker.locker_number
      || ' (' || to_char(p_start_date, 'DD Mon YYYY') || ' - ' || to_char(v_effective_end_date, 'DD Mon YYYY') || ')';

    INSERT INTO public.invoice_items (invoice_id, item_type, item_name, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_invoice_id, 'locker', v_item_label, 1, v_gst.taxable, v_gst_rate, v_gst.cgst + v_gst.sgst + v_gst.igst, v_gst.total)
    RETURNING id INTO v_invoice_item_id;
  END IF;

  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'invoice_id', v_invoice_id, 'locker_id', p_locker_id,
                            'branch_id', v_branch_id, 'end_date', v_effective_end_date, 'chargeable', v_chargeable);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event('error','database', SQLERRM, 'assign_locker_with_billing', NULL,'lockers', v_branch_id, p_received_by, NULL, NULL, NULL,
    jsonb_build_object('locker_id',p_locker_id,'member_id',p_member_id));
  RAISE;
END; $function$;

-- 2) Backdated payments: new overload with an explicit payment date.
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
    UPDATE public.invoices
       SET paid_at = v_date
     WHERE id = p_invoice_id AND status = 'paid';
  END IF;

  RETURN v_result || jsonb_build_object('payment_date', v_date);
END; $function$;

GRANT EXECUTE ON FUNCTION public.record_payment(uuid,uuid,uuid,numeric,text,timestamptz,text,text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid,uuid,uuid,numeric,text,timestamptz,text,text,uuid,uuid) TO service_role;

-- 3) Gift days / membership extension
GRANT SELECT ON public.membership_free_days TO authenticated;
GRANT ALL ON public.membership_free_days TO service_role;

CREATE OR REPLACE FUNCTION public.grant_membership_free_days(
  p_membership_id uuid,
  p_days integer,
  p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_m record;
  v_id uuid;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_any_role(v_uid, ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_days,0) <= 0 OR p_days > 365 THEN
    RAISE EXCEPTION 'INVALID_DAYS: must be between 1 and 365' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(btrim(p_reason),'') = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_m FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MEMBERSHIP_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_m.status NOT IN ('active','frozen','pending') THEN
    RAISE EXCEPTION 'MEMBERSHIP_NOT_EXTENDABLE: status is %', v_m.status USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.membership_free_days (membership_id, days_added, reason, added_by)
  VALUES (p_membership_id, p_days, btrim(p_reason), v_uid)
  RETURNING id INTO v_id;

  UPDATE public.memberships
     SET end_date = end_date + p_days,
         updated_at = now()
   WHERE id = p_membership_id;

  RETURN jsonb_build_object(
    'success', true,
    'free_days_id', v_id,
    'membership_id', p_membership_id,
    'days_added', p_days,
    'new_end_date', v_m.end_date + p_days
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.revoke_membership_free_days(p_free_days_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_row record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.membership_free_days WHERE id = p_free_days_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRANT_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  UPDATE public.memberships
     SET end_date = end_date - v_row.days_added,
         updated_at = now()
   WHERE id = v_row.membership_id;

  DELETE FROM public.membership_free_days WHERE id = p_free_days_id;

  RETURN jsonb_build_object('success', true, 'membership_id', v_row.membership_id, 'days_removed', v_row.days_added);
END; $function$;

GRANT EXECUTE ON FUNCTION public.grant_membership_free_days(uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_membership_free_days(uuid) TO authenticated;

DROP POLICY IF EXISTS "staff_read_membership_free_days" ON public.membership_free_days;
CREATE POLICY "staff_read_membership_free_days"
  ON public.membership_free_days FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role]));

-- 4) Backfill: month-based plans should end on a calendar boundary (inclusive).
UPDATE public.memberships m
SET end_date = (m.start_date + (
      CASE p.duration_days
        WHEN 30 THEN interval '1 month'
        WHEN 90 THEN interval '3 months'
        WHEN 180 THEN interval '6 months'
        WHEN 365 THEN interval '1 year'
      END))::date - 1,
    updated_at = now()
FROM public.membership_plans p
WHERE p.id = m.plan_id
  AND m.status IN ('active','pending')
  AND p.duration_days IN (30,90,180,365)
  AND m.end_date < (m.start_date + (
      CASE p.duration_days
        WHEN 30 THEN interval '1 month'
        WHEN 90 THEN interval '3 months'
        WHEN 180 THEN interval '6 months'
        WHEN 365 THEN interval '1 year'
      END))::date - 1;