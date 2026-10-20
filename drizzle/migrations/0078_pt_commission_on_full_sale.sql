CREATE OR REPLACE FUNCTION public.generate_pt_commission(_member_package_id uuid, _payment_mode text)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _pkg RECORD; _rate numeric; _ded numeric; _months integer;
  _base numeric; _gst numeric; _net numeric; _per numeric;
  _commission_id uuid; _remaining numeric; _amt numeric;
  _balance numeric := 0; _status text; _reason text; i integer;
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
    SELECT GREATEST(COALESCE(total_amount,0) - COALESCE(amount_paid,0), 0) INTO _balance
      FROM public.invoices WHERE id = _pkg.invoice_id;
  END IF;
  _balance := COALESCE(_balance, 0);

  -- Commission = share % of the PT sale amount; trainer pays GST % on the commission only.
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
END;
$function$;

-- Backfill: recompute commissions that have no paid / payroll-linked instalment yet.
WITH tgt AS (
  SELECT tc.id, round(COALESCE(tc.total_sale_amount,0) * COALESCE(tc.percentage,40)/100.0, 2) AS base,
         COALESCE(t.commission_deduction_percentage,5) AS ded
    FROM public.trainer_commissions tc JOIN public.trainers t ON t.id = tc.trainer_id
   WHERE tc.commission_type = 'package_sale'
     AND NOT EXISTS (SELECT 1 FROM public.pt_commission_installments i
                      WHERE i.commission_id = tc.id AND (i.status = 'paid' OR i.payroll_item_id IS NOT NULL))
), calc AS (
  SELECT id, base, round(base*ded/100.0,2) AS gst, base - round(base*ded/100.0,2) AS net FROM tgt
), upd AS (
  UPDATE public.trainer_commissions tc SET base_commission = c.base, gst_deduction = c.gst,
         net_total_commission = c.net, amount = c.net
    FROM calc c WHERE tc.id = c.id RETURNING tc.id, c.net
), cnt AS (
  SELECT i.id, u.net, i.installment_index,
         count(*) OVER (PARTITION BY i.commission_id) AS n
    FROM public.pt_commission_installments i JOIN upd u ON u.id = i.commission_id
)
UPDATE public.pt_commission_installments i
   SET installment_amount = CASE WHEN cnt.installment_index = cnt.n
         THEN cnt.net - round(cnt.net / cnt.n, 2) * (cnt.n - 1)
         ELSE round(cnt.net / cnt.n, 2) END
  FROM cnt WHERE i.id = cnt.id;