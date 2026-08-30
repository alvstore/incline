-- 1. Commission generation: GST-exclusive base, separate GST deduction
CREATE OR REPLACE FUNCTION public.generate_pt_commission(_member_package_id uuid, _payment_mode text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pkg RECORD;
  _inv RECORD;
  _rate numeric; _ded numeric; _months integer;
  _cbase numeric; _base numeric; _gst numeric; _net numeric; _per numeric;
  _commission_id uuid; _remaining numeric; _amt numeric;
  _balance numeric := 0; _status text; _reason text; i integer;
BEGIN
  SELECT mp.*, p.duration_months AS plan_months
    INTO _pkg
    FROM public.member_pt_packages mp
    JOIN public.pt_packages p ON p.id = mp.package_id
   WHERE mp.id = _member_package_id;

  IF NOT FOUND OR _pkg.trainer_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(pt_share_percentage, 40), COALESCE(commission_deduction_percentage, 5)
    INTO _rate, _ded
    FROM public.trainers WHERE id = _pkg.trainer_id;
  _rate := COALESCE(_rate, 40);
  _ded  := COALESCE(_ded, 5);

  _months := GREATEST(COALESCE(_pkg.plan_months, 1), 1);

  IF _pkg.invoice_id IS NOT NULL THEN
    SELECT COALESCE(is_gst_invoice,false) AS is_gst,
           COALESCE(subtotal,0) AS subtotal,
           COALESCE(tax_amount,0) AS tax_amount,
           GREATEST(COALESCE(total_amount,0) - COALESCE(amount_paid,0), 0) AS balance
      INTO _inv
      FROM public.invoices WHERE id = _pkg.invoice_id;
  END IF;

  -- Commission base is ALWAYS exclusive of GST
  IF _inv IS NOT NULL AND _inv.is_gst AND _inv.tax_amount > 0 AND _inv.subtotal > 0 THEN
    _cbase := _inv.subtotal;
  ELSE
    _cbase := COALESCE(_pkg.price_paid, 0);
  END IF;

  _base := round(_cbase * (_rate / 100.0), 2);

  -- GST deduction only when the underlying PT invoice actually carries GST
  IF _inv IS NOT NULL AND _inv.is_gst AND _inv.tax_amount > 0 THEN
    _gst := round(_base * (_ded / 100.0), 2);
  ELSE
    _gst := 0;
  END IF;

  _net := round(_base - _gst, 2);

  _balance := COALESCE(_inv.balance, 0);

  IF _balance > 0 THEN
    _status := 'blocked';
    _reason := 'Member dues outstanding: ' || to_char(_balance, 'FM999999990.00');
  ELSE
    _status := 'pending';
    _reason := NULL;
  END IF;

  DELETE FROM public.trainer_commissions WHERE pt_package_id = _member_package_id;

  INSERT INTO public.trainer_commissions (
    trainer_id, pt_package_id, member_id, branch_id, commission_type,
    amount, percentage, status, kind, release_date, sale_date,
    plan_duration_months, total_sale_amount, payment_mode,
    base_commission, gst_deduction, net_total_commission
  ) VALUES (
    _pkg.trainer_id, _member_package_id, _pkg.member_id, _pkg.branch_id, 'package_sale',
    _net, _rate, 'pending', 'earned', COALESCE(_pkg.start_date, CURRENT_DATE), COALESCE(_pkg.start_date, CURRENT_DATE),
    _months, _pkg.price_paid, lower(COALESCE(_payment_mode,'cash')),
    _base, _gst, _net
  ) RETURNING id INTO _commission_id;

  _per := round(_net / _months, 2);
  _remaining := _net;

  FOR i IN 0.._months - 1 LOOP
    _amt := CASE WHEN i = _months - 1 THEN round(_remaining, 2) ELSE _per END;
    _remaining := _remaining - _amt;
    INSERT INTO public.pt_commission_installments (
      commission_id, trainer_id, branch_id, payout_month, installment_index,
      installment_amount, status, blocked_reason, released_at
    ) VALUES (
      _commission_id, _pkg.trainer_id, _pkg.branch_id,
      (date_trunc('month', COALESCE(_pkg.start_date, CURRENT_DATE)::timestamp) + make_interval(months => i))::date,
      i + 1, _amt, _status, _reason,
      CASE WHEN _status = 'pending' THEN now() ELSE NULL END
    );
  END LOOP;

  RETURN _net;
END;
$function$;

-- 2. Payroll eligibility: fully paid invoice, not already attached, not reversed/cancelled
CREATE OR REPLACE FUNCTION public.pt_commission_due_for_period(_user_id uuid, _period_start date, _period_end date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(i.installment_amount), 0)
  FROM public.pt_commission_installments i
  JOIN public.trainers t ON t.id = i.trainer_id
  JOIN public.trainer_commissions tc ON tc.id = i.commission_id
  LEFT JOIN public.member_pt_packages mp ON mp.id = tc.pt_package_id
  LEFT JOIN public.invoices inv ON inv.id = mp.invoice_id
  WHERE t.user_id = _user_id
    AND i.status = 'pending'
    AND i.payroll_item_id IS NULL
    AND COALESCE(tc.kind,'earned') = 'earned'
    AND COALESCE(tc.status,'pending') NOT IN ('reversed','cancelled')
    AND (inv.id IS NULL OR GREATEST(COALESCE(inv.total_amount,0) - COALESCE(inv.amount_paid,0), 0) = 0)
    AND i.payout_month >= date_trunc('month', _period_start)::date
    AND i.payout_month <= _period_end;
$function$;

-- 3. Release blocked installments whenever an invoice balance reaches zero
CREATE OR REPLACE FUNCTION public.tg_invoice_release_pt_commission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF GREATEST(COALESCE(NEW.total_amount,0) - COALESCE(NEW.amount_paid,0), 0) = 0
     AND GREATEST(COALESCE(OLD.total_amount,0) - COALESCE(OLD.amount_paid,0), 0) > 0 THEN
    PERFORM public.release_pt_commission_for_invoice(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_invoice_release_pt_commission ON public.invoices;
CREATE TRIGGER trg_invoice_release_pt_commission
AFTER UPDATE OF amount_paid, total_amount ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_release_pt_commission();

-- 4. payroll_mark_paid: only eligible, unattached installments
CREATE OR REPLACE FUNCTION public.payroll_mark_paid(p_item_ids uuid[], p_method text, p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item record;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners/admins can mark payroll as paid';
  END IF;

  UPDATE public.payroll_items
    SET status = 'paid', payment_method = p_method, payment_reference = p_reference, updated_at = now()
    WHERE id = ANY(p_item_ids) AND status = 'processed';

  FOR v_item IN
    SELECT pi.id, pi.user_id, pr.period_start, pr.period_end
      FROM public.payroll_items pi
      JOIN public.payroll_runs pr ON pr.id = pi.run_id
     WHERE pi.id = ANY(p_item_ids) AND pi.status = 'paid'
  LOOP
    UPDATE public.pt_commission_installments i
       SET status = 'paid', paid_at = now(), payroll_item_id = v_item.id, updated_at = now()
     WHERE i.id IN (
       SELECT i2.id
         FROM public.pt_commission_installments i2
         JOIN public.trainers t ON t.id = i2.trainer_id
         JOIN public.trainer_commissions tc ON tc.id = i2.commission_id
         LEFT JOIN public.member_pt_packages mp ON mp.id = tc.pt_package_id
         LEFT JOIN public.invoices inv ON inv.id = mp.invoice_id
        WHERE t.user_id = v_item.user_id
          AND i2.status = 'pending'
          AND i2.payroll_item_id IS NULL
          AND COALESCE(tc.kind,'earned') = 'earned'
          AND COALESCE(tc.status,'pending') NOT IN ('reversed','cancelled')
          AND (inv.id IS NULL OR GREATEST(COALESCE(inv.total_amount,0) - COALESCE(inv.amount_paid,0), 0) = 0)
          AND i2.payout_month >= date_trunc('month', v_item.period_start)::date
          AND i2.payout_month <= v_item.period_end
     );
  END LOOP;

  INSERT INTO public.payroll_audit (item_id, actor_id, action, after_data)
    SELECT unnest(p_item_ids), auth.uid(), 'item_paid',
           jsonb_build_object('method', p_method, 'reference', p_reference);
END;
$function$;

-- 5. Security: block self-service edits of staff-controlled profile columns
CREATE OR REPLACE FUNCTION public.tg_profiles_guard_sensitive_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(),'owner')
     OR public.has_role(auth.uid(),'admin')
     OR public.has_role(auth.uid(),'manager')
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.government_id_verified := OLD.government_id_verified;
  NEW.is_active := OLD.is_active;
  NEW.must_set_password := OLD.must_set_password;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_profiles_guard_sensitive_fields ON public.profiles;
CREATE TRIGGER trg_profiles_guard_sensitive_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_guard_sensitive_fields();

REVOKE ALL ON FUNCTION public.tg_invoice_release_pt_commission() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_profiles_guard_sensitive_fields() FROM PUBLIC, anon;