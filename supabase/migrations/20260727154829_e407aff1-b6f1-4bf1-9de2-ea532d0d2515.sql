-- 1. Fix locker_status value in assign_locker_with_billing (both overloads).
CREATE OR REPLACE FUNCTION public.assign_locker_with_billing(
  p_locker_id uuid, p_member_id uuid, p_start_date date, p_end_date date,
  p_fee_amount numeric, p_billing_months integer DEFAULT 1,
  p_chargeable boolean DEFAULT true, p_gst_rate numeric DEFAULT NULL::numeric,
  p_received_by uuid DEFAULT NULL::uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_locker record; v_assignment_id uuid; v_invoice_id uuid := NULL;
  v_invoice_item_id uuid; v_branch_id uuid; v_total numeric;
  v_gst_rate numeric; v_gst record;
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
    INSERT INTO public.invoices (member_id, branch_id, total_amount, amount_paid, status, payment_method, due_date, created_by)
    VALUES (p_member_id, v_branch_id, v_gst.total, 0, 'pending', NULL, p_end_date, p_received_by)
    RETURNING id INTO v_invoice_id;
    INSERT INTO public.invoice_items (invoice_id, item_type, item_name, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_invoice_id, 'locker',
      'Locker ' || v_locker.locker_number || ' (' || COALESCE(p_billing_months,1) || ' month' || CASE WHEN COALESCE(p_billing_months,1)>1 THEN 's' ELSE '' END || ')',
      1, v_gst.taxable, v_gst_rate, v_gst.cgst + v_gst.sgst + v_gst.igst, v_gst.total)
    RETURNING id INTO v_invoice_item_id;
  END IF;

  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'invoice_id', v_invoice_id, 'locker_id', p_locker_id, 'branch_id', v_branch_id);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event('error','database', SQLERRM, 'assign_locker_with_billing', NULL,'lockers', v_branch_id, p_received_by, NULL, NULL, NULL,
    jsonb_build_object('locker_id',p_locker_id,'member_id',p_member_id));
  RAISE;
END; $function$;

CREATE OR REPLACE FUNCTION public.assign_locker_with_billing(
  p_locker_id uuid, p_member_id uuid, p_start_date date, p_end_date date,
  p_fee_amount numeric, p_billing_months integer DEFAULT 1,
  p_chargeable boolean DEFAULT true, p_gst_rate numeric DEFAULT NULL::numeric,
  p_received_by uuid DEFAULT NULL::uuid, p_assign_source text DEFAULT 'addon'::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_locker record; v_assignment_id uuid; v_invoice_id uuid := NULL;
  v_invoice_item_id uuid; v_branch_id uuid; v_total numeric;
  v_gst_rate numeric; v_gst record;
  v_effective_end_date date; v_membership_end date; v_chargeable boolean;
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
    INSERT INTO public.invoices (member_id, branch_id, total_amount, amount_paid, status, payment_method, due_date, created_by)
    VALUES (p_member_id, v_branch_id, v_gst.total, 0, 'pending', NULL, v_effective_end_date, p_received_by)
    RETURNING id INTO v_invoice_id;
    INSERT INTO public.invoice_items (invoice_id, item_type, item_name, quantity, unit_price, tax_rate, tax_amount, total_amount)
    VALUES (v_invoice_id, 'locker',
      'Locker ' || v_locker.locker_number || ' (' || COALESCE(p_billing_months,1) || ' month' || CASE WHEN COALESCE(p_billing_months,1)>1 THEN 's' ELSE '' END || ')',
      1, v_gst.taxable, v_gst_rate, v_gst.cgst + v_gst.sgst + v_gst.igst, v_gst.total)
    RETURNING id INTO v_invoice_item_id;
  END IF;

  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'invoice_id', v_invoice_id, 'locker_id', p_locker_id, 'branch_id', v_branch_id, 'source', p_assign_source, 'end_date', v_effective_end_date);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event('error','database', SQLERRM, 'assign_locker_with_billing', NULL,'lockers', v_branch_id, p_received_by, NULL, NULL, NULL,
    jsonb_build_object('locker_id', p_locker_id, 'member_id', p_member_id, 'source', p_assign_source));
  RAISE;
END; $function$;

-- Also normalize any lockers already stuck at 'occupied' (shouldn't exist since insert would've failed, but safety).
-- No update needed: enum can't hold 'occupied', so no rows.

-- 2. Break members RLS recursion by moving trainer/mpp lookups into a SECURITY DEFINER helper.
CREATE OR REPLACE FUNCTION public.trainer_can_view_member(_user_id uuid, _member_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.members m
    JOIN public.trainers t ON t.id = m.assigned_trainer_id
    WHERE m.id = _member_id AND t.user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.member_pt_packages mpp
    JOIN public.trainers t ON t.id = mpp.trainer_id
    WHERE mpp.member_id = _member_id
      AND t.user_id = _user_id
      AND mpp.status = 'active'::pt_package_status
  );
$$;

DROP POLICY IF EXISTS "View members policy" ON public.members;
CREATE POLICY "View members policy" ON public.members
FOR SELECT
USING (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND (
      branch_id = get_user_branch(auth.uid())
      OR manages_branch(auth.uid(), branch_id)
    )
  )
  OR (
    has_role(auth.uid(), 'trainer'::app_role)
    AND public.trainer_can_view_member(auth.uid(), id)
  )
);