CREATE OR REPLACE FUNCTION public.assign_locker_with_billing(p_locker_id uuid, p_member_id uuid, p_start_date date, p_end_date date, p_fee_amount numeric, p_billing_months integer DEFAULT 1, p_chargeable boolean DEFAULT true, p_gst_rate numeric DEFAULT NULL::numeric, p_received_by uuid DEFAULT NULL::uuid, p_assign_source text DEFAULT 'addon'::text)
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
  -- SEC_GUARD_STAFF_V1
  IF NOT public.is_staff_or_system() THEN
    RAISE EXCEPTION 'Unauthorized: staff role required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_locker FROM public.lockers WHERE id = p_locker_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LOCKER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  v_branch_id := v_locker.branch_id;

  -- Branch authority: direct callers must be staff of the locker's branch, and the member must belong to it.
  IF public.rpc_guard_applies('assign_locker_with_billing') THEN
    PERFORM public.assert_branch_staff(v_branch_id, false, 'assigning a locker');
    IF NOT EXISTS (SELECT 1 FROM public.members WHERE id = p_member_id AND branch_id = v_branch_id) THEN
      RAISE EXCEPTION 'forbidden: member does not belong to this locker''s branch' USING ERRCODE = '42501';
    END IF;
    IF p_received_by IS NOT NULL AND p_received_by <> auth.uid() THEN
      p_received_by := auth.uid();
    END IF;
  END IF;

  IF v_locker.status <> 'available' THEN
    RAISE EXCEPTION 'LOCKER_TAKEN: locker % is %', v_locker.locker_number, v_locker.status USING ERRCODE = 'P0001';
  END IF;
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