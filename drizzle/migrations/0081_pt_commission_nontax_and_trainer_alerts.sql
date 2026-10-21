CREATE OR REPLACE FUNCTION public.generate_pt_commission(_member_package_id uuid, _payment_mode text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _pkg RECORD; _rate numeric; _ded numeric; _months integer;
  _base numeric; _gst numeric; _net numeric; _per numeric;
  _commission_id uuid; _remaining numeric; _amt numeric;
  _balance numeric := 0; _status text; _reason text; i integer;
  _taxed boolean := true;
BEGIN
  SELECT mp.*, p.duration_months AS plan_months INTO _pkg
    FROM public.member_pt_packages mp JOIN public.pt_packages p ON p.id = mp.package_id
   WHERE mp.id = _member_package_id;
  IF NOT FOUND OR _pkg.trainer_id IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(pt_share_percentage, 40), COALESCE(commission_deduction_percentage, 5)
    INTO _rate, _ded FROM public.trainers WHERE id = _pkg.trainer_id;
  _rate := COALESCE(_rate, 40); _ded := COALESCE(_ded, 5);
  _months := GREATEST(COALESCE(_pkg.plan_months, 1), 1);

  IF _pkg.invoice_id IS NOT NULL THEN
    SELECT GREATEST(COALESCE(total_amount,0) - COALESCE(amount_paid,0), 0),
           (COALESCE(is_gst_invoice,false) OR COALESCE(tax_amount,0) > 0)
      INTO _balance, _taxed
      FROM public.invoices WHERE id = _pkg.invoice_id;
  END IF;
  _balance := COALESCE(_balance, 0);
  -- Non-tax (cash / BOS) sale: no GST was charged, so no GST cut on the trainer's commission.
  IF NOT COALESCE(_taxed, true) THEN _ded := 0; END IF;

  _base := round(COALESCE(_pkg.price_paid,0) * (_rate / 100.0), 2);
  _gst  := round(_base * (_ded / 100.0), 2);
  _net  := round(_base - _gst, 2);

  IF _balance > 0 THEN
    _status := 'blocked'; _reason := 'Member dues outstanding: ' || to_char(_balance, 'FM999999990.00');
  ELSE _status := 'pending'; _reason := NULL; END IF;

  DELETE FROM public.trainer_commissions WHERE pt_package_id = _member_package_id;
  INSERT INTO public.trainer_commissions (
    trainer_id, pt_package_id, member_id, branch_id, commission_type, amount, percentage, status, kind,
    release_date, sale_date, plan_duration_months, total_sale_amount, payment_mode,
    base_commission, gst_deduction, net_total_commission
  ) VALUES (
    _pkg.trainer_id, _member_package_id, _pkg.member_id, _pkg.branch_id, 'package_sale', _net, _rate, 'pending', 'earned',
    COALESCE(_pkg.start_date, CURRENT_DATE), COALESCE(_pkg.start_date, CURRENT_DATE), _months, _pkg.price_paid,
    lower(COALESCE(_payment_mode,'cash')), _base, _gst, _net
  ) RETURNING id INTO _commission_id;

  _per := round(_net / _months, 2); _remaining := _net;
  FOR i IN 0.._months - 1 LOOP
    _amt := CASE WHEN i = _months - 1 THEN round(_remaining, 2) ELSE _per END;
    _remaining := _remaining - _amt;
    INSERT INTO public.pt_commission_installments (
      commission_id, trainer_id, branch_id, payout_month, installment_index, installment_amount, status, blocked_reason, released_at
    ) VALUES (
      _commission_id, _pkg.trainer_id, _pkg.branch_id,
      (date_trunc('month', COALESCE(_pkg.start_date, CURRENT_DATE)::timestamp) + make_interval(months => i))::date,
      i + 1, _amt, _status, _reason, CASE WHEN _status = 'pending' THEN now() ELSE NULL END);
  END LOOP;
  RETURN _net;
END; $function$;

-- Backfill: non-tax sales whose commission has no paid instalment get regenerated without the GST cut.
DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT tc.pt_package_id, tc.payment_mode FROM public.trainer_commissions tc
    JOIN public.member_pt_packages mp ON mp.id = tc.pt_package_id
    JOIN public.invoices iv ON iv.id = mp.invoice_id
    WHERE tc.kind = 'earned' AND COALESCE(tc.gst_deduction,0) > 0
      AND NOT COALESCE(iv.is_gst_invoice,false) AND COALESCE(iv.tax_amount,0) = 0
      AND NOT EXISTS (SELECT 1 FROM public.pt_commission_installments pi WHERE pi.commission_id = tc.id AND pi.status = 'paid')
      AND tc.status <> 'paid'
  LOOP
    PERFORM public.generate_pt_commission(r.pt_package_id, r.payment_mode);
  END LOOP;
END $$;

-- Trainer alerts: member with an active PT package checks in at the gate (once per member per IST day).
CREATE OR REPLACE FUNCTION public._pt_notify_trainer_checkin(p_member_id uuid, p_at timestamptz)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; _day date := timezone('Asia/Kolkata', p_at)::date; _name text; _due numeric;
BEGIN
  SELECT COALESCE(pr.full_name, m.member_code, 'Your client') INTO _name
    FROM public.members m LEFT JOIN public.profiles pr ON pr.id = m.user_id WHERE m.id = p_member_id;
  FOR r IN
    SELECT mp.id, mp.branch_id, mp.invoice_id, t.user_id AS trainer_user, pk.name AS pkg
      FROM public.member_pt_packages mp
      JOIN public.trainers t ON t.id = mp.trainer_id
      LEFT JOIN public.pt_packages pk ON pk.id = mp.package_id
     WHERE mp.member_id = p_member_id AND mp.status = 'active' AND t.user_id IS NOT NULL
  LOOP
    IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = r.trainer_user AND n.category = 'pt_client_checkin'
               AND n.metadata->>'member_id' = p_member_id::text AND n.metadata->>'day' = _day::text) THEN CONTINUE; END IF;
    INSERT INTO public.notifications(user_id, branch_id, title, message, type, category, action_url, metadata)
    VALUES (r.trainer_user, r.branch_id, 'Client checked in',
            _name || ' just checked in at ' || to_char(timezone('Asia/Kolkata', p_at), 'HH12:MI AM') || COALESCE(' · ' || r.pkg, ''),
            'info', 'pt_client_checkin', '/trainer-dashboard',
            jsonb_build_object('member_id', p_member_id, 'day', _day, 'pt_package_id', r.id));
    IF r.invoice_id IS NOT NULL THEN
      SELECT GREATEST(COALESCE(total_amount,0) - COALESCE(amount_paid,0), 0) INTO _due FROM public.invoices WHERE id = r.invoice_id;
      IF COALESCE(_due,0) > 0 THEN
        INSERT INTO public.notifications(user_id, branch_id, title, message, type, category, action_url, metadata)
        VALUES (r.trainer_user, r.branch_id, 'PT package dues pending',
                _name || ' has PT package dues outstanding. Your commission is on hold until it is cleared — please remind them to visit the front desk.',
                'warning', 'pt_dues', '/trainer-earnings',
                jsonb_build_object('member_id', p_member_id, 'day', _day, 'pt_package_id', r.id));
      END IF;
    END IF;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public._pt_notify_trainer_checkin(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pt_notify_trainer_checkin(uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_pt_auto_access_log()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF NEW.member_id IS NOT NULL AND NEW.result IN ('member','accepted') THEN
      IF EXISTS (SELECT 1 FROM public.member_pt_packages WHERE member_id = NEW.member_id AND status = 'active') THEN
        PERFORM public._pt_auto_on_member_presence(NEW.member_id, COALESCE(NEW.captured_at, NEW.created_at));
        BEGIN
          PERFORM public._pt_notify_trainer_checkin(NEW.member_id, COALESCE(NEW.captured_at, NEW.created_at));
        EXCEPTION WHEN OTHERS THEN NULL; END;
      END IF;
    ELSIF NEW.profile_id IS NOT NULL AND NEW.result IN ('trainer','staff','accepted') THEN
      IF EXISTS (SELECT 1 FROM public.trainers t JOIN public.member_pt_packages m ON m.trainer_id = t.id AND m.status = 'active' WHERE t.user_id = NEW.profile_id) THEN
        PERFORM public._pt_auto_on_trainer_presence(NEW.profile_id, COALESCE(NEW.captured_at, NEW.created_at));
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN PERFORM public.log_error_event('warning','pt_auto_attendance',SQLERRM,'tg_pt_auto_access_log',NULL,'access_logs',NEW.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
  RETURN NULL;
END; $function$;