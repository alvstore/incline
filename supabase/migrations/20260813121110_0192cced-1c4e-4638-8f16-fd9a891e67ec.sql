ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS commission_deduction_percentage numeric NOT NULL DEFAULT 5;

COMMENT ON COLUMN public.trainers.commission_deduction_percentage IS
  'Percentage deducted from the trainer''s gross PT commission before payout (GST/levy). 0 for net-of-tax arrangements.';

UPDATE public.trainers SET commission_deduction_percentage = 0 WHERE COALESCE(pt_share_percentage, 40) >= 50;

CREATE OR REPLACE FUNCTION public.generate_pt_commission(_member_package_id uuid, _payment_mode text)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _pkg RECORD;
  _rate numeric;
  _ded numeric;
  _months integer;
  _base numeric;
  _gst numeric;
  _net numeric;
  _per numeric;
  _commission_id uuid;
  _remaining numeric;
  _amt numeric;
  _balance numeric := 0;
  _status text;
  _reason text;
  i integer;
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

  _base := round(COALESCE(_pkg.price_paid,0) * (_rate / 100.0), 2);
  _gst  := round(_base * (_ded / 100.0), 2);
  _net  := round(_base - _gst, 2);

  IF _pkg.invoice_id IS NOT NULL THEN
    SELECT GREATEST(COALESCE(total_amount,0) - COALESCE(amount_paid,0), 0)
      INTO _balance
      FROM public.invoices WHERE id = _pkg.invoice_id;
  END IF;
  _balance := COALESCE(_balance, 0);

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