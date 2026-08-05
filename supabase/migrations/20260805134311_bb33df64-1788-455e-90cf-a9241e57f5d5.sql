-- 1. Member visibility on recovery slots ------------------------------------
DROP POLICY IF EXISTS "Authenticated can view active slots" ON public.benefit_slots;
CREATE POLICY "Authenticated can view active slots"
ON public.benefit_slots FOR SELECT TO authenticated
USING (
  is_active = true
  AND (
    branch_id IS NULL
    OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    OR branch_id = public.member_branch_id(public.get_member_id(auth.uid()))
  )
);

-- facilities: members already covered by gender clause, but make branch explicit
DROP POLICY IF EXISTS "Read matching facilities" ON public.facilities;
CREATE POLICY "Read matching facilities"
ON public.facilities FOR SELECT TO authenticated
USING (
  is_active = true
  AND (
    gender_access = 'unisex'
    OR gender_access = (SELECT p.gender::text FROM public.profiles p WHERE p.id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role])
  )
);

-- 2. Invoice defaults trigger: invalid enum + trusted-caller bypass ----------
CREATE OR REPLACE FUNCTION public.recompute_member_invoice_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_staff boolean;
  v_sub numeric;
  v_tax numeric;
BEGIN
  v_is_staff := has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role]);
  IF v_is_staff
     OR auth.role() = 'service_role'
     OR COALESCE(current_setting('app.trusted_invoice', true), '') = 'true'
  THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(unit_price * quantity),0), COALESCE(SUM(tax_amount),0)
    INTO v_sub, v_tax
    FROM public.invoice_items WHERE invoice_id = NEW.id;

  NEW.subtotal        := v_sub;
  NEW.tax_amount      := v_tax;
  NEW.discount_amount := 0;
  NEW.total_amount    := v_sub + v_tax;
  NEW.amount_paid     := 0;
  NEW.status          := COALESCE(NEW.status, 'pending'::invoice_status);
  RETURN NEW;
END;
$function$;

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
  IF uid IS NULL OR COALESCE(current_setting('app.trusted_invoice', true), '') = 'true' THEN
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

-- 3. Add-on purchase: mark itself trusted, drop stale overload ---------------
DROP FUNCTION IF EXISTS public.purchase_benefit_credits(uuid, uuid, uuid, uuid, text, text, uuid);

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

  -- Trusted server routine: totals computed here must survive the member guards.
  PERFORM set_config('app.trusted_invoice', 'true', true);

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

  IF p_defer_settlement THEN
    PERFORM set_config('app.trusted_invoice', 'false', true);
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

  PERFORM set_config('app.trusted_invoice', 'false', true);

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

GRANT EXECUTE ON FUNCTION public.purchase_benefit_credits(uuid, uuid, uuid, uuid, text, text, uuid, boolean) TO authenticated;

-- 4. Security: branch-scope payment reminders -------------------------------
DROP POLICY IF EXISTS "Staff can view payment reminders" ON public.payment_reminders;
DROP POLICY IF EXISTS "Staff can create payment reminders" ON public.payment_reminders;
DROP POLICY IF EXISTS "Staff can update payment reminders" ON public.payment_reminders;

CREATE POLICY "Staff can view payment reminders"
ON public.payment_reminders FOR SELECT TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

CREATE POLICY "Staff can create payment reminders"
ON public.payment_reminders FOR INSERT TO authenticated
WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

CREATE POLICY "Staff can update payment reminders"
ON public.payment_reminders FOR UPDATE TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  OR (
    public.has_any_role(auth.uid(), ARRAY['manager'::app_role, 'staff'::app_role])
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);