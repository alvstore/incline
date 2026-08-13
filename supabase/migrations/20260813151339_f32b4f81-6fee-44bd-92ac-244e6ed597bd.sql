CREATE OR REPLACE FUNCTION public.purchase_member_membership(
  p_member_id uuid,
  p_plan_id uuid,
  p_branch_id uuid,
  p_start_date date,
  p_amount_paying numeric DEFAULT 0,
  p_payment_method text DEFAULT 'cash',
  p_payment_source text DEFAULT 'staff',
  p_discount_amount numeric DEFAULT 0,
  p_discount_reason text DEFAULT NULL,
  p_include_gst boolean DEFAULT true,
  p_gst_rate numeric DEFAULT 0,
  p_payment_due_date date DEFAULT NULL,
  p_send_reminders boolean DEFAULT true,
  p_assign_locker_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_received_by uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_transaction_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_member public.members%ROWTYPE;
  v_plan public.membership_plans%ROWTYPE;
  v_membership public.memberships%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_existing_event public.member_lifecycle_events%ROWTYPE;
  v_base_price numeric := 0;
  v_admission_fee numeric := 0;
  v_gross_amount numeric := 0;
  v_subtotal numeric := 0;
  v_tax_amount numeric := 0;
  v_total_amount numeric := 0;
  v_end_date date;
  v_payment_result jsonb;
  v_remaining_amount numeric := 0;
  v_due_date date;
  v_effective_rate numeric := 0;
  v_is_inclusive boolean := false;
  v_gst record;
  v_new_status public.membership_status;
  v_is_advance boolean := false;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_event FROM public.member_lifecycle_events
    WHERE member_id = p_member_id AND entity_type = 'membership_purchase'
      AND idempotency_key = p_idempotency_key
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'member_id', p_member_id, 'idempotent', true, 'entity_id', v_existing_event.entity_id);
    END IF;
  END IF;

  SELECT * INTO v_member FROM public.members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Member not found'); END IF;
  IF v_member.branch_id <> p_branch_id THEN RETURN jsonb_build_object('success', false, 'error', 'Member branch mismatch'); END IF;

  SELECT * INTO v_plan FROM public.membership_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Membership plan not found'); END IF;

  v_is_advance := p_start_date > current_date;

  v_base_price := COALESCE(v_plan.discounted_price, v_plan.price, 0);
  v_admission_fee := COALESCE(v_plan.admission_fee, 0);
  v_gross_amount := GREATEST(v_base_price + v_admission_fee - COALESCE(p_discount_amount, 0), 0);
  v_effective_rate := COALESCE(NULLIF(p_gst_rate, 0), COALESCE(v_plan.gst_rate, 0));
  v_is_inclusive := COALESCE(v_plan.is_gst_inclusive, true);

  IF p_include_gst AND v_effective_rate > 0 THEN
    SELECT * INTO v_gst FROM public.calc_gst(v_gross_amount, v_effective_rate, v_is_inclusive, true);
    v_subtotal := v_gst.taxable; v_tax_amount := v_gst.cgst + v_gst.sgst + v_gst.igst; v_total_amount := v_gst.total;
  ELSE
    v_subtotal := v_gross_amount; v_tax_amount := 0; v_total_amount := v_gross_amount;
  END IF;

  -- Billing is always dated from today, even when the membership is backdated.
  v_due_date := COALESCE(p_payment_due_date, GREATEST(p_start_date, current_date));
  v_end_date := public.membership_end_date(p_start_date, COALESCE(v_plan.duration_days, 1));

  INSERT INTO public.memberships (
    member_id, plan_id, branch_id, status, start_date, end_date, original_end_date,
    price_paid, discount_amount, discount_reason, notes, created_by
  ) VALUES (
    p_member_id, p_plan_id, p_branch_id, 'pending'::public.membership_status,
    p_start_date, v_end_date, v_end_date, v_total_amount,
    COALESCE(p_discount_amount, 0), p_discount_reason, p_notes, p_received_by
  ) RETURNING * INTO v_membership;

  INSERT INTO public.invoices (
    branch_id, member_id, status, subtotal, discount_amount, tax_amount, total_amount,
    amount_paid, due_date, payment_due_date, notes, created_by,
    is_gst_invoice, gst_rate, source, invoice_type
  ) VALUES (
    p_branch_id, p_member_id, 'pending'::public.invoice_status,
    v_subtotal, COALESCE(p_discount_amount, 0), v_tax_amount, v_total_amount, 0,
    v_due_date,
    CASE WHEN p_amount_paying < v_total_amount THEN v_due_date ELSE NULL END,
    p_notes, p_received_by, p_include_gst,
    CASE WHEN p_include_gst THEN v_effective_rate ELSE 0 END,
    p_payment_source, 'membership'
  ) RETURNING * INTO v_invoice;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total_amount, reference_type, reference_id)
  VALUES (
    v_invoice.id, format('%s - %s days', v_plan.name, v_plan.duration_days), 1,
    CASE WHEN p_include_gst AND v_is_inclusive AND v_effective_rate > 0
         THEN round(v_base_price / (1 + v_effective_rate/100.0), 2) ELSE v_base_price END,
    CASE WHEN p_include_gst AND v_is_inclusive AND v_effective_rate > 0
         THEN round(v_base_price / (1 + v_effective_rate/100.0), 2) ELSE v_base_price END,
    'membership', v_membership.id
  );

  IF v_admission_fee > 0 THEN
    INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, total_amount, reference_type, reference_id)
    VALUES (
      v_invoice.id, 'Admission Fee', 1,
      CASE WHEN p_include_gst AND v_is_inclusive AND v_effective_rate > 0
           THEN round(v_admission_fee / (1 + v_effective_rate/100.0), 2) ELSE v_admission_fee END,
      CASE WHEN p_include_gst AND v_is_inclusive AND v_effective_rate > 0
           THEN round(v_admission_fee / (1 + v_effective_rate/100.0), 2) ELSE v_admission_fee END,
      'admission_fee', v_membership.id
    );
  END IF;

  IF p_assign_locker_id IS NOT NULL AND COALESCE(v_plan.includes_free_locker, false) THEN
    INSERT INTO public.locker_assignments (locker_id, member_id, start_date, end_date, fee_amount, is_active)
    VALUES (p_assign_locker_id, p_member_id, p_start_date, v_end_date, 0, false);
  END IF;

  IF COALESCE(p_amount_paying, 0) > 0 THEN
    v_payment_result := public.settle_payment(
      p_branch_id, v_invoice.id, p_member_id, p_amount_paying, p_payment_method,
      p_transaction_id, p_notes, p_received_by, NULL, p_payment_source, p_idempotency_key, NULL, NULL,
      jsonb_build_object('membership_id', v_membership.id, 'plan_id', p_plan_id)
    );
    IF COALESCE((v_payment_result ->> 'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_payment_result;
    END IF;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_invoice.id;
  v_remaining_amount := GREATEST(COALESCE(v_invoice.total_amount, 0) - COALESCE(v_invoice.amount_paid, 0), 0);

  v_new_status := CASE
    WHEN v_is_advance THEN 'pending'::public.membership_status
    WHEN v_invoice.status = 'paid'::public.invoice_status THEN 'active'::public.membership_status
    WHEN COALESCE(v_invoice.amount_paid, 0) > 0
         AND v_due_date IS NOT NULL
         AND v_due_date >= current_date
      THEN 'active'::public.membership_status
    ELSE 'pending'::public.membership_status
  END;

  UPDATE public.memberships
  SET status = v_new_status, updated_at = now()
  WHERE id = v_membership.id
  RETURNING * INTO v_membership;

  IF p_send_reminders AND v_remaining_amount > 0 THEN
    INSERT INTO public.payment_reminders (
      branch_id, invoice_id, member_id, reminder_type, scheduled_for, status, delivery_status, channel
    )
    SELECT p_branch_id, v_invoice.id, p_member_id, reminder_type, scheduled_for, 'pending', 'scheduled'::public.reminder_delivery_status, channel
    FROM (VALUES
      ('payment_due', (v_due_date - INTERVAL '3 days')::timestamptz, 'whatsapp'),
      ('payment_due', v_due_date::timestamptz, 'sms'),
      ('overdue', (v_due_date + INTERVAL '3 days')::timestamptz, 'email')
    ) AS reminder_plan(reminder_type, scheduled_for, channel)
    WHERE scheduled_for > now();
  END IF;

  IF p_assign_locker_id IS NOT NULL AND COALESCE(v_plan.includes_free_locker, false)
     AND v_membership.status = 'active'::public.membership_status THEN
    UPDATE public.locker_assignments SET is_active = true
    WHERE member_id = p_member_id AND locker_id = p_assign_locker_id AND start_date = p_start_date;
    UPDATE public.lockers SET status = 'assigned' WHERE id = p_assign_locker_id;
  END IF;

  PERFORM public.log_member_lifecycle_event(
    p_branch_id, p_member_id, p_received_by, 'membership_purchase',
    v_membership.id,
    CASE WHEN v_is_advance THEN 'membership_scheduled' ELSE 'membership_purchased' END,
    NULL, v_membership.status::text,
    p_payment_source, p_notes, p_idempotency_key,
    jsonb_build_object('invoice_id', v_invoice.id, 'plan_id', p_plan_id,
                       'remaining_amount', v_remaining_amount,
                       'scheduled_start', p_start_date, 'is_advance_booking', v_is_advance)
  );

  IF NOT v_is_advance THEN
    PERFORM public.evaluate_member_access_state(p_member_id, p_received_by, 'Membership purchase evaluated', true);
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'member_id', p_member_id, 'membership_id', v_membership.id,
    'invoice_id', v_invoice.id, 'invoice_status', v_invoice.status,
    'membership_status', v_membership.status, 'amount_paid', v_invoice.amount_paid,
    'remaining_amount', v_remaining_amount, 'is_advance_booking', v_is_advance
  );
END;
$fn$;