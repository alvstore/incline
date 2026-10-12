CREATE OR REPLACE FUNCTION public.renew_pt_package(_member_package_id uuid, _price numeric DEFAULT NULL::numeric, _payment_method text DEFAULT 'cash'::text, _payment_source text DEFAULT 'in_person'::text, _idempotency_key text DEFAULT NULL::text, _package_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old record;
  _pkg record;
  _start date;
  _price_final numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  -- Kill switch (default OFF): one-click renewal skipped price, GST/BOS and
  -- payment-mode confirmation. Renewals go through purchase_pt_package via the drawer.
  IF NOT COALESCE((SELECT (value)::text = 'true' FROM public.settings
                    WHERE branch_id IS NULL AND key = 'pt_renew_direct_enabled' LIMIT 1), false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Direct renewal is disabled — use the PT purchase drawer');
  END IF;

  SELECT * INTO _old FROM public.member_pt_packages WHERE id = _member_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Package not found');
  END IF;

  IF _old.status NOT IN ('active'::pt_package_status, 'expired'::pt_package_status, 'exhausted'::pt_package_status) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only active or finished packages can be renewed', 'status', _old.status);
  END IF;

  SELECT * INTO _pkg FROM public.pt_packages
   WHERE id = COALESCE(_package_id, _old.package_id) AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plan not found or inactive');
  END IF;

  _start := GREATEST(CURRENT_DATE, COALESCE(_old.expiry_date, CURRENT_DATE) + 1);
  _price_final := COALESCE(_price, _pkg.price);

  RETURN public._purchase_pt_package_impl(
    _old.member_id, _pkg.id, _old.trainer_id, _old.branch_id, _price_final,
    5, _payment_method, _payment_source,
    COALESCE(_idempotency_key, 'renew-' || _member_package_id::text || '-' || _start::text),
    auth.uid(), _start
  ) || jsonb_build_object('renewed_from', _member_package_id);
END;
$function$;