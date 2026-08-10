CREATE OR REPLACE FUNCTION public.upgrade_membership(
  p_membership_id uuid,
  p_new_plan_id uuid,
  p_reason text DEFAULT NULL::text,
  p_payment_method text DEFAULT 'cash'::text,
  p_amount_paying numeric DEFAULT 0,
  p_include_gst boolean DEFAULT false,
  p_gst_rate numeric DEFAULT 0,
  p_idempotency_key text DEFAULT NULL::text,
  p_discount_amount numeric DEFAULT 0,
  p_discount_reason text DEFAULT NULL::text,
  p_send_reminders boolean DEFAULT true,
  p_assign_locker_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_old public.memberships%ROWTYPE;
  v_new public.memberships%ROWTYPE;
  v_old_plan public.membership_plans%ROWTYPE;
  v_new_plan public.membership_plans%ROWTYPE;
  v_invoice public.invoices%ROWTYPE;
  v_existing public.member_lifecycle_events%ROWTYPE;
  v_credit numeric := 0;
  v_gross numeric := 0;
  v_discount numeric := 0;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_rate numeric := 0;
  v_inclusive boolean := true;
  v_gst record;
  v_gift_days integer := 0;
  v_freeze_days integer := 0;
  v_end date;
  v_balance numeric := 0;
  v_payment jsonb;
  v_unit numeric := 0;
  v_locker jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_capability(v_actor, 'cancel_membership') THEN
    RAISE EXCEPTION 'NOT_ALLOWED: only owners/admins/managers may upgrade memberships'
      USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.member_lifecycle_events
     WHERE entity_type = 'membership_upgrade' AND idempotency_key = p_idempotency_key
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'membership_id', v_existing.entity_id);
    END IF;
  END IF;

  SELECT * INTO v_old FROM public.memberships WHERE id = p_membership_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Membership not found');
  END IF;

  IF v_old.status <> 'active'::public.membership_status THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Only an active membership can be upgraded (current: %s)', v_old.status));
  END IF;

  SELECT * INTO v_old_plan FROM public.membership_plans WHERE id = v_old.plan_id;
  SELECT * INTO v_new_plan FROM public.membership_plans WHERE id = p_new_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'New plan not found');
  END IF;
  IF p_new_plan_id = v_old.plan_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Member is already on this plan');
  END IF;

  SELECT i.* INTO v_invoice
    FROM public.invoices i
    JOIN public.invoice_items ii ON ii.invoice_id = i.id
   WHERE ii.reference_id = v_old.id
     AND ii.reference_type IN ('membership', 'admission_fee')
     AND i.status <> 'cancelled'::public.invoice_status
   ORDER BY i.created_at DESC
   LIMIT 1
   FOR UPDATE OF i;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'No open invoice found for the current membership — cannot apply the upgrade credit');
  END IF;

  v_credit := GREATEST(COALESCE(v_invoice.amount_paid, 0), 0);

  v_gross := GREATEST(COALESCE(v_new_plan.discounted_price, v_new_plan.price, 0), 0);
  v_discount := LEAST(GREATEST(COALESCE(p_discount_amount, 0), 0), v_gross);
  v_gross := GREATEST(v_gross - v_discount, 0);

  IF v_gross <= v_credit THEN
    RETURN jsonb_build_object('success', false,
      'error', format('DOWNGRADE_NOT_SUPPORTED: new plan (%s) is not higher value than the credit already paid (%s)',
                      v_gross, v_credit));
  END IF;

  v_rate := COALESCE(NULLIF(p_gst_rate, 0), COALESCE(v_new_plan.gst_rate, 0));
  v_inclusive := COALESCE(v_new_plan.is_gst_inclusive, true);

  IF p_include_gst AND v_rate > 0 THEN
    SELECT * INTO v_gst FROM public.calc_gst(v_gross, v_rate, v_inclusive, true);
    v_subtotal := v_gst.taxable;
    v_tax := v_gst.cgst + v_gst.sgst + v_gst.igst;
    v_total := v_gst.total;
  ELSE
    v_subtotal := v_gross; v_tax := 0; v_total := v_gross;
  END IF;

  SELECT COALESCE(SUM(days_added), 0) INTO v_gift_days
    FROM public.membership_free_days WHERE membership_id = v_old.id;
  v_freeze_days := COALESCE(v_old.total_freeze_days_used, 0);

  v_end := public.membership_end_date(v_old.start_date, COALESCE(v_new_plan.duration_days, 1))
           + (v_gift_days + v_freeze_days);

  UPDATE public.memberships
     SET status = 'upgraded'::public.membership_status,
         end_date = LEAST(end_date, CURRENT_DATE),
         notes = COALESCE(notes, '') || E'\n[' || to_char(now(), 'YYYY-MM-DD HH24:MI') ||
                 '] Upgraded to ' || v_new_plan.name || COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
         updated_at = now()
   WHERE id = v_old.id;

  INSERT INTO public.memberships (
    member_id, plan_id, branch_id, status, start_date, end_date, original_end_date,
    price_paid, discount_amount, discount_reason, notes, created_by,
    total_freeze_days_used, upgraded_from_membership_id, upgrade_credit_amount
  ) VALUES (
    v_old.member_id, p_new_plan_id, v_old.branch_id, 'active'::public.membership_status,
    v_old.start_date, v_end, v_end, v_total, v_discount, NULLIF(trim(p_discount_reason), ''),
    'Upgraded from ' || COALESCE(v_old_plan.name, 'previous plan') ||
      COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
    v_actor, v_freeze_days, v_old.id, v_credit
  ) RETURNING * INTO v_new;

  INSERT INTO public.membership_free_days (membership_id, days_added, reason, added_by)
  SELECT v_new.id, days_added, 'Carried from upgraded plan: ' || COALESCE(reason, ''), added_by
    FROM public.membership_free_days WHERE membership_id = v_old.id;

  DELETE FROM public.invoice_items WHERE invoice_id = v_invoice.id;

  v_unit := CASE WHEN p_include_gst AND v_inclusive AND v_rate > 0
                 THEN round(v_gross / (1 + v_rate / 100.0), 2) ELSE v_gross END;

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount,
    reference_type, reference_id
  ) VALUES (
    v_invoice.id,
    format('%s - %s days (%s to %s)%s', v_new_plan.name, v_new_plan.duration_days,
           to_char(v_new.start_date, 'DD Mon YYYY'), to_char(v_new.end_date, 'DD Mon YYYY'),
           CASE WHEN v_discount > 0 THEN format(' — after discount %s', to_char(v_discount, 'FM999999990.00')) ELSE '' END),
    1, v_unit, CASE WHEN p_include_gst THEN v_rate ELSE 0 END, v_tax, v_unit,
    'membership', v_new.id
  );

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit_price, tax_rate, tax_amount, total_amount,
    reference_type, reference_id
  ) VALUES (
    v_invoice.id,
    format('Upgrade credit — %s (%s to %s), already paid %s',
           COALESCE(v_old_plan.name, 'previous plan'),
           to_char(v_old.start_date, 'DD Mon YYYY'), to_char(CURRENT_DATE, 'DD Mon YYYY'),
           to_char(v_credit, 'FM999999990.00')),
    1, 0, 0, 0, 0, 'upgrade_credit', v_old.id
  );

  UPDATE public.invoices
     SET subtotal = v_subtotal,
         discount_amount = v_discount,
         tax_amount = v_tax,
         total_amount = v_total,
         is_gst_invoice = p_include_gst,
         gst_rate = CASE WHEN p_include_gst THEN v_rate ELSE 0 END,
         invoice_type = 'membership',
         status = CASE
                    WHEN v_credit >= v_total THEN 'paid'::public.invoice_status
                    WHEN v_credit > 0 THEN 'partial'::public.invoice_status
                    ELSE 'pending'::public.invoice_status
                  END,
         payment_due_date = CASE WHEN v_credit < v_total
                                 THEN COALESCE(payment_due_date, CURRENT_DATE + 7) END,
         notes = COALESCE(notes, '') || E'\n[' || to_char(now(), 'YYYY-MM-DD HH24:MI') ||
                 '] Upgraded ' || COALESCE(v_old_plan.name, 'previous plan') || ' -> ' || v_new_plan.name ||
                 '; credit applied ' || to_char(v_credit, 'FM999999990.00') ||
                 CASE WHEN v_discount > 0 THEN '; discount ' || to_char(v_discount, 'FM999999990.00') ||
                      COALESCE(' (' || NULLIF(trim(p_discount_reason), '') || ')', '') ELSE '' END ||
                 '; new total ' || to_char(v_total, 'FM999999990.00') ||
                 COALESCE(' — ' || NULLIF(trim(p_reason), ''), ''),
         updated_at = now()
   WHERE id = v_invoice.id;

  DELETE FROM public.payment_reminders
   WHERE invoice_id = v_invoice.id AND status = 'pending';

  IF COALESCE(p_amount_paying, 0) > 0 THEN
    v_payment := public.settle_payment(
      v_old.branch_id, v_invoice.id, v_old.member_id, p_amount_paying, p_payment_method,
      NULL, 'Membership upgrade to ' || v_new_plan.name, v_actor, NULL, 'manual',
      CASE WHEN p_idempotency_key IS NULL THEN NULL ELSE p_idempotency_key || ':pay' END,
      NULL, NULL,
      jsonb_build_object('membership_id', v_new.id, 'plan_id', p_new_plan_id, 'upgrade', true)
    );
    IF COALESCE((v_payment ->> 'success')::boolean, false) IS NOT TRUE THEN
      RETURN v_payment;
    END IF;
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_invoice.id;
  v_balance := GREATEST(COALESCE(v_invoice.total_amount, 0) - COALESCE(v_invoice.amount_paid, 0), 0);

  IF v_balance > 0 AND COALESCE(p_send_reminders, true) THEN
    INSERT INTO public.payment_reminders (
      branch_id, invoice_id, member_id, reminder_type, scheduled_for, status, delivery_status, channel
    )
    SELECT v_old.branch_id, v_invoice.id, v_old.member_id, reminder_type, scheduled_for,
           'pending', 'scheduled'::public.reminder_delivery_status, channel
      FROM (VALUES
        ('payment_due', (COALESCE(v_invoice.payment_due_date, CURRENT_DATE + 7) - INTERVAL '3 days')::timestamptz, 'whatsapp'),
        ('payment_due', COALESCE(v_invoice.payment_due_date, CURRENT_DATE + 7)::timestamptz, 'sms'),
        ('overdue', (COALESCE(v_invoice.payment_due_date, CURRENT_DATE + 7) + INTERVAL '3 days')::timestamptz, 'email')
      ) AS r(reminder_type, scheduled_for, channel)
     WHERE scheduled_for > now();
  END IF;

  IF p_assign_locker_id IS NOT NULL THEN
    BEGIN
      v_locker := public.assign_locker_with_billing(
        p_assign_locker_id, v_old.member_id, v_new.id, true, 0, NULL
      );
    EXCEPTION WHEN others THEN
      v_locker := jsonb_build_object('success', false, 'error', SQLERRM);
    END;
  END IF;

  PERFORM public.log_member_lifecycle_event(
    v_old.branch_id, v_old.member_id, v_actor, 'membership_upgrade', v_new.id,
    'membership_upgraded', v_old_plan.name, v_new_plan.name, 'manual',
    NULLIF(trim(p_reason), ''), p_idempotency_key,
    jsonb_build_object(
      'old_membership_id', v_old.id, 'new_membership_id', v_new.id,
      'invoice_id', v_invoice.id, 'credit_applied', v_credit,
      'discount_amount', v_discount, 'discount_reason', NULLIF(trim(p_discount_reason), ''),
      'new_total', v_total, 'balance_due', v_balance,
      'start_date', v_new.start_date, 'end_date', v_new.end_date,
      'carried_gift_days', v_gift_days, 'carried_freeze_days', v_freeze_days,
      'locker', v_locker
    )
  );

  PERFORM public.evaluate_member_access_state(v_old.member_id, v_actor, 'Membership upgraded', true);

  RETURN jsonb_build_object(
    'success', true,
    'old_membership_id', v_old.id,
    'membership_id', v_new.id,
    'invoice_id', v_invoice.id,
    'invoice_status', v_invoice.status,
    'credit_applied', v_credit,
    'discount_amount', v_discount,
    'new_total', v_total,
    'amount_paid', v_invoice.amount_paid,
    'balance_due', v_balance,
    'locker', v_locker,
    'start_date', v_new.start_date,
    'end_date', v_new.end_date
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.upgrade_membership(uuid, uuid, text, text, numeric, boolean, numeric, text);