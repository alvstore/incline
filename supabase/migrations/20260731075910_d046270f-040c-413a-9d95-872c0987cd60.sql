-- 1) Locker billing: invoice_items has no item_type/item_name columns.
DROP FUNCTION IF EXISTS public.assign_locker_with_billing(uuid,uuid,date,date,numeric,integer,boolean,numeric,uuid);

CREATE OR REPLACE FUNCTION public.assign_locker_with_billing(
  p_locker_id uuid, p_member_id uuid, p_start_date date, p_end_date date,
  p_fee_amount numeric, p_billing_months integer DEFAULT 1, p_chargeable boolean DEFAULT true,
  p_gst_rate numeric DEFAULT NULL::numeric, p_received_by uuid DEFAULT NULL::uuid,
  p_assign_source text DEFAULT 'addon'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount, reference_type, reference_id)
    VALUES (v_invoice_id, v_item_label, 1, v_gst.taxable, v_gst_rate, v_gst.cgst + v_gst.sgst + v_gst.igst, v_gst.total, 'locker', p_locker_id)
    RETURNING id INTO v_invoice_item_id;
  END IF;

  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'invoice_id', v_invoice_id, 'locker_id', p_locker_id,
                            'branch_id', v_branch_id, 'end_date', v_effective_end_date, 'chargeable', v_chargeable);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event('error','database', SQLERRM, 'assign_locker_with_billing', NULL,'lockers', v_branch_id, p_received_by, NULL, NULL, NULL,
    jsonb_build_object('locker_id',p_locker_id,'member_id',p_member_id));
  RAISE;
END; $function$;

-- 2) Edit / remove complimentary (gift) days, shifting the membership end date.
CREATE OR REPLACE FUNCTION public.adjust_membership_free_days(
  _free_day_id uuid,
  _new_days integer DEFAULT NULL,
  _delete boolean DEFAULT false,
  _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.membership_free_days%ROWTYPE;
  v_ms public.memberships%ROWTYPE;
  v_delta integer;
  v_new_end date;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owners and admins can adjust complimentary days');
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A reason is required');
  END IF;

  SELECT * INTO v_row FROM public.membership_free_days WHERE id = _free_day_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Gift entry not found'); END IF;

  SELECT * INTO v_ms FROM public.memberships WHERE id = v_row.membership_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Membership not found'); END IF;

  IF _delete THEN
    v_delta := -COALESCE(v_row.days_added, 0);
    DELETE FROM public.membership_free_days WHERE id = _free_day_id;
  ELSE
    IF _new_days IS NULL OR _new_days < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Provide a valid number of days');
    END IF;
    v_delta := _new_days - COALESCE(v_row.days_added, 0);
    UPDATE public.membership_free_days
       SET days_added = _new_days,
           reason = COALESCE(v_row.reason, '') || ' | adjusted: ' || _reason
     WHERE id = _free_day_id;
  END IF;

  v_new_end := v_ms.end_date + v_delta;
  UPDATE public.memberships SET end_date = v_new_end, updated_at = now() WHERE id = v_ms.id;

  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    v_ms.branch_id, auth.uid(),
    CASE WHEN _delete THEN 'gift_days_removed' ELSE 'gift_days_adjusted' END,
    'membership_free_days', _free_day_id,
    jsonb_build_object('days_added', v_row.days_added, 'end_date', v_ms.end_date),
    jsonb_build_object('days_added', COALESCE(_new_days, 0), 'end_date', v_new_end, 'reason', _reason)
  );

  RETURN jsonb_build_object('success', true, 'delta_days', v_delta, 'new_end_date', v_new_end);
END; $$;

REVOKE ALL ON FUNCTION public.adjust_membership_free_days(uuid,integer,boolean,text) FROM public;
GRANT EXECUTE ON FUNCTION public.adjust_membership_free_days(uuid,integer,boolean,text) TO authenticated;

-- 3) Edit a recorded payment: void + re-record atomically (owner/admin only).
CREATE OR REPLACE FUNCTION public.edit_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date timestamptz DEFAULT NULL,
  p_transaction_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_reason text DEFAULT 'Payment corrected')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_void jsonb;
  v_new jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owners and admins can edit payments');
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payment not found'); END IF;
  IF v_payment.invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only invoice-linked payments can be edited');
  END IF;

  v_void := public.void_payment(p_payment_id, 'Superseded by correction: ' || p_reason);
  IF NOT COALESCE((v_void->>'success')::boolean, false) THEN RETURN v_void; END IF;

  v_new := public.record_payment(
    v_payment.branch_id,
    v_payment.invoice_id,
    v_payment.member_id,
    p_amount,
    p_payment_method::public.payment_method,
    COALESCE(p_transaction_id, v_payment.transaction_id),
    COALESCE(p_notes, v_payment.notes),
    auth.uid(),
    v_payment.income_category_id,
    COALESCE(p_payment_date, v_payment.payment_date)
  );

  RETURN jsonb_build_object('success', true, 'voided_payment_id', p_payment_id, 'new_payment', v_new);
END; $$;

REVOKE ALL ON FUNCTION public.edit_payment(uuid,numeric,text,timestamptz,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.edit_payment(uuid,numeric,text,timestamptz,text,text,text) TO authenticated;