CREATE OR REPLACE FUNCTION public.calculate_upgrade_cost(p_member_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_offer RECORD;
  v_paid NUMERIC(12,2);
BEGIN
  IF public.rpc_guard_applies('calculate_upgrade_cost') THEN
    IF NOT (public.is_own_member(p_member_id) OR public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::text[])) THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT o.*, m.start_date, m.status AS membership_status
    INTO v_offer
    FROM public.upgrade_offers o
    JOIN public.memberships m ON m.id = o.membership_id
   WHERE o.member_id = p_member_id
     AND o.status IN ('pending','day7_sent','day12_sent')
   ORDER BY o.created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_active_offer');
  END IF;

  IF v_offer.window_ends_at < now() OR v_offer.membership_status <> 'active' THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'window_expired');
  END IF;

  -- Live paid total: completed payments on invoices that bill the source membership.
  SELECT COALESCE(SUM(p.amount), 0)
    INTO v_paid
    FROM public.payments p
   WHERE p.status = 'completed'
     AND p.invoice_id IN (
       SELECT ii.invoice_id FROM public.invoice_items ii
        WHERE ii.reference_type IN ('membership','membership_renewal')
          AND ii.reference_id = v_offer.membership_id
     );

  v_paid := GREATEST(v_paid, COALESCE(v_offer.already_paid, 0));

  RETURN jsonb_build_object(
    'eligible', true,
    'offer_id', v_offer.id,
    'annual_price', v_offer.annual_price,
    'already_paid', v_paid,
    'upgrade_cost', GREATEST(COALESCE(v_offer.annual_price, 0) - v_paid, 0),
    'window_ends_at', v_offer.window_ends_at,
    'days_left', GREATEST((v_offer.window_ends_at::date - (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)
  );
END;
$function$;
GRANT EXECUTE ON FUNCTION public.calculate_upgrade_cost(uuid) TO authenticated, service_role;