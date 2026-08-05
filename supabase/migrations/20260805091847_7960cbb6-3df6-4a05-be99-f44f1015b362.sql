-- 1. Repair the member invoice defaults trigger (columns paid_at/payment_method/payment_reference do not exist)
CREATE OR REPLACE FUNCTION public.enforce_member_invoice_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  is_staff boolean := false;
BEGIN
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid
      AND role IN ('owner','admin','manager','staff','trainer')
  ) INTO is_staff;
  IF is_staff THEN
    RETURN NEW;
  END IF;

  IF NEW.member_id IS NULL OR NEW.member_id <> public.get_member_id(uid) THEN
    RAISE EXCEPTION 'members can only create invoices for themselves';
  END IF;

  NEW.status := 'pending'::public.invoice_status;
  NEW.amount_paid := 0;
  NEW.discount_amount := GREATEST(COALESCE(NEW.discount_amount, 0), 0);
  NEW.invoice_number := NULL;

  RETURN NEW;
END;
$function$;

-- 2. Single source of truth for member access eligibility (dues aware)
CREATE OR REPLACE FUNCTION public.member_access_status(_member_id uuid, _branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch uuid;
  v_block boolean := true;
  v_grace int := 0;
  v_outstanding numeric := 0;
  v_oldest date;
  v_days int := 0;
BEGIN
  SELECT branch_id INTO v_branch FROM public.members WHERE id = _member_id;
  v_branch := COALESCE(_branch_id, v_branch);

  SELECT COALESCE(bs.block_access_on_overdue, true), COALESCE(bs.overdue_grace_days, 0)
    INTO v_block, v_grace
  FROM public.branch_settings bs
  WHERE bs.branch_id = v_branch;

  IF NOT FOUND THEN
    v_block := true;
    v_grace := 0;
  END IF;

  SELECT COALESCE(SUM(GREATEST(i.total_amount - COALESCE(i.amount_paid, 0), 0)), 0),
         MIN(COALESCE(i.payment_due_date, i.due_date))
    INTO v_outstanding, v_oldest
  FROM public.invoices i
  WHERE i.member_id = _member_id
    AND i.status IN ('pending','partial','overdue')
    AND COALESCE(i.total_amount, 0) - COALESCE(i.amount_paid, 0) > 0
    AND COALESCE(i.payment_due_date, i.due_date) IS NOT NULL
    AND COALESCE(i.payment_due_date, i.due_date) + (v_grace || ' days')::interval < CURRENT_DATE;

  IF v_oldest IS NOT NULL THEN
    v_days := GREATEST((CURRENT_DATE - v_oldest)::int, 0);
  END IF;

  IF v_outstanding > 0 AND v_block THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'dues_overdue',
      'outstanding_amount', v_outstanding,
      'days_overdue', v_days,
      'oldest_due_date', v_oldest,
      'blocking_enabled', v_block
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', NULL,
    'outstanding_amount', v_outstanding,
    'days_overdue', v_days,
    'oldest_due_date', v_oldest,
    'blocking_enabled', v_block
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.member_access_status(uuid, uuid) TO authenticated, service_role;

-- Bulk helper used by the hardware revocation sweep
CREATE OR REPLACE FUNCTION public.members_blocked_for_dues()
RETURNS TABLE (
  member_id uuid,
  member_code text,
  branch_id uuid,
  mips_person_sn text,
  hardware_access_status text,
  outstanding_amount numeric,
  days_overdue int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT m.id,
         m.member_code,
         m.branch_id,
         m.mips_person_sn,
         m.hardware_access_status,
         (public.member_access_status(m.id, m.branch_id) ->> 'outstanding_amount')::numeric,
         (public.member_access_status(m.id, m.branch_id) ->> 'days_overdue')::int
  FROM public.members m
  WHERE (public.member_access_status(m.id, m.branch_id) ->> 'allowed')::boolean IS FALSE;
$function$;

GRANT EXECUTE ON FUNCTION public.members_blocked_for_dues() TO authenticated, service_role;

-- 3. Check-in validation now rejects overdue members
CREATE OR REPLACE FUNCTION public.validate_member_checkin(_member_id uuid, _branch_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_membership RECORD;
  v_open_attendance RECORD;
  v_access jsonb;
BEGIN
  SELECT * INTO v_open_attendance
  FROM public.member_attendance
  WHERE member_id = _member_id
    AND check_out IS NULL
  ORDER BY check_in DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN json_build_object(
      'valid', false,
      'reason', 'already_checked_in',
      'message', 'Member is already checked in',
      'attendance_id', v_open_attendance.id,
      'check_in_time', v_open_attendance.check_in
    );
  END IF;

  SELECT m.*, mp.name as plan_name INTO v_membership
  FROM public.memberships m
  JOIN public.membership_plans mp ON m.plan_id = mp.id
  WHERE m.member_id = _member_id
    AND m.status = 'active'
    AND m.branch_id = _branch_id
    AND CURRENT_DATE BETWEEN m.start_date AND m.end_date
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT m.*, mp.name as plan_name INTO v_membership
    FROM public.memberships m
    JOIN public.membership_plans mp ON m.plan_id = mp.id
    WHERE m.member_id = _member_id
    ORDER BY m.end_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN json_build_object(
        'valid', false,
        'reason', 'no_membership',
        'message', 'No membership found for this member'
      );
    ELSIF v_membership.status = 'frozen' THEN
      RETURN json_build_object(
        'valid', false,
        'reason', 'frozen',
        'message', 'Membership is frozen'
      );
    ELSIF v_membership.end_date < CURRENT_DATE THEN
      RETURN json_build_object(
        'valid', false,
        'reason', 'expired',
        'message', 'Membership expired on ' || v_membership.end_date::TEXT
      );
    ELSIF v_membership.branch_id <> _branch_id THEN
      RETURN json_build_object(
        'valid', false,
        'reason', 'wrong_branch',
        'message', 'Membership belongs to a different branch'
      );
    ELSE
      RETURN json_build_object(
        'valid', false,
        'reason', 'inactive',
        'message', 'Membership is not active'
      );
    END IF;
  END IF;

  -- Dues gate
  v_access := public.member_access_status(_member_id, _branch_id);
  IF (v_access ->> 'allowed')::boolean IS FALSE THEN
    RETURN json_build_object(
      'valid', false,
      'reason', 'dues_overdue',
      'message', 'Access blocked: dues of Rs. ' || ROUND((v_access->>'outstanding_amount')::numeric, 2)::text
                 || ' overdue by ' || COALESCE(v_access->>'days_overdue','0') || ' day(s)',
      'outstanding_amount', (v_access->>'outstanding_amount')::numeric,
      'days_overdue', (v_access->>'days_overdue')::int,
      'membership_id', v_membership.id
    );
  END IF;

  RETURN json_build_object(
    'valid', true,
    'membership_id', v_membership.id,
    'plan_name', v_membership.plan_name,
    'days_remaining', v_membership.end_date - CURRENT_DATE
  );
END;
$function$;

-- 4. Deferred settlement for online add-on purchases
CREATE OR REPLACE FUNCTION public.purchase_benefit_credits(
  p_member_id uuid,
  p_membership_id uuid,
  p_package_id uuid,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_payment_method text DEFAULT 'cash'::text,
  p_idempotency_key text DEFAULT NULL::text,
  p_received_by uuid DEFAULT auth.uid(),
  p_defer_settlement boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_branch_id uuid;
  v_invoice_id uuid;
  v_credit_id uuid;
  v_settle_result jsonb;
  v_expires_at timestamptz;
  v_rate numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
BEGIN
  SELECT * INTO v_pkg FROM public.benefit_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  v_branch_id := COALESCE(p_branch_id, v_pkg.branch_id);
  IF v_branch_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Branch missing');
  END IF;

  v_expires_at := now() + (v_pkg.validity_days || ' days')::interval;

  v_rate := COALESCE(v_pkg.tax_rate, 0) / 100.0;
  IF COALESCE(v_pkg.tax_inclusive, true) THEN
    v_total    := ROUND(v_pkg.price::numeric, 2);
    v_subtotal := ROUND(v_total / (1 + v_rate), 2);
    v_tax      := ROUND(v_total - v_subtotal, 2);
  ELSE
    v_subtotal := ROUND(v_pkg.price::numeric, 2);
    v_tax      := ROUND(v_subtotal * v_rate, 2);
    v_total    := ROUND(v_subtotal + v_tax, 2);
  END IF;

  INSERT INTO public.invoices (
    branch_id, member_id, subtotal, tax_amount, total_amount, amount_paid,
    status, due_date, payment_due_date, invoice_type, is_gst_invoice, gst_rate, notes
  ) VALUES (
    v_branch_id, p_member_id, v_subtotal, v_tax, v_total, 0,
    'pending'::public.invoice_status, CURRENT_DATE, CURRENT_DATE, 'benefit_addon',
    COALESCE(v_pkg.tax_rate, 0) > 0, COALESCE(v_pkg.tax_rate, 0),
    CASE WHEN p_defer_settlement
      THEN 'benefit_addon:' || p_package_id::text || ':' || COALESCE(p_membership_id::text, '')
      ELSE NULL END
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, unit_price, quantity, tax_rate, tax_amount, total_amount,
    hsn_code, reference_type, reference_id
  ) VALUES (
    v_invoice_id,
    format('Add-on: %s (%s credits)', v_pkg.name, v_pkg.quantity),
    v_subtotal, 1, COALESCE(v_pkg.tax_rate, 0), v_tax, v_subtotal,
    v_pkg.hsn_code, 'benefit_package', p_package_id
  );

  -- Online flow: invoice stays pending, credits are issued after payment confirmation.
  IF p_defer_settlement THEN
    RETURN jsonb_build_object(
      'success', true,
      'deferred', true,
      'invoice_id', v_invoice_id,
      'amount', v_total,
      'subtotal', v_subtotal,
      'tax_amount', v_tax
    );
  END IF;

  BEGIN
    INSERT INTO public.member_benefit_credits (
      member_id, membership_id, benefit_type, package_id,
      credits_total, credits_remaining, expires_at, invoice_id
    ) VALUES (
      p_member_id, p_membership_id, v_pkg.benefit_type, p_package_id,
      v_pkg.quantity, v_pkg.quantity, v_expires_at, v_invoice_id
    ) RETURNING id INTO v_credit_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'benefit_credits_insert_failed: %', SQLERRM;
  END;

  v_settle_result := public.settle_payment(
    v_branch_id,
    v_invoice_id,
    p_member_id,
    v_total,
    p_payment_method,
    NULL, NULL, p_received_by, NULL,
    'benefit_addon',
    p_idempotency_key,
    NULL, NULL,
    jsonb_build_object('package_id', p_package_id, 'membership_id', p_membership_id, 'credit_id', v_credit_id)
  );

  IF COALESCE((v_settle_result ->> 'success')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'settle_payment_failed: %', COALESCE(v_settle_result->>'error','unknown');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'credit_id', v_credit_id,
    'invoice_id', v_invoice_id,
    'amount', v_total,
    'subtotal', v_subtotal,
    'tax_amount', v_tax
  );
END;
$function$;

-- Issue benefit credits once an online add-on invoice is paid (idempotent)
CREATE OR REPLACE FUNCTION public.activate_benefit_credits_for_invoice(_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv RECORD;
  v_item RECORD;
  v_pkg RECORD;
  v_membership_id uuid;
  v_credit_id uuid;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = _invoice_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invoice not found');
  END IF;

  IF EXISTS (SELECT 1 FROM public.member_benefit_credits WHERE invoice_id = _invoice_id) THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  SELECT * INTO v_item
  FROM public.invoice_items
  WHERE invoice_id = _invoice_id AND reference_type = 'benefit_package'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No benefit package line item');
  END IF;

  SELECT * INTO v_pkg FROM public.benefit_packages WHERE id = v_item.reference_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  SELECT id INTO v_membership_id
  FROM public.memberships
  WHERE member_id = v_inv.member_id AND status = 'active'
  ORDER BY end_date DESC LIMIT 1;

  INSERT INTO public.member_benefit_credits (
    member_id, membership_id, benefit_type, package_id,
    credits_total, credits_remaining, expires_at, invoice_id
  ) VALUES (
    v_inv.member_id, v_membership_id, v_pkg.benefit_type, v_pkg.id,
    v_pkg.quantity, v_pkg.quantity,
    now() + (v_pkg.validity_days || ' days')::interval, _invoice_id
  ) RETURNING id INTO v_credit_id;

  RETURN jsonb_build_object('success', true, 'credit_id', v_credit_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.activate_benefit_credits_for_invoice(uuid) TO authenticated, service_role;