CREATE OR REPLACE FUNCTION public.cancel_class_booking(_booking_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _booking RECORD; _next_waitlist RECORD; _caller_member uuid;
  _promoted boolean := false; _class RECORD; _val jsonb; _promo_invoice uuid; _inv_res jsonb; _released integer := 0; _inv_cancelled integer := 0;
BEGIN
  SELECT b.*, c.branch_id AS class_branch_id, c.scheduled_at AS class_scheduled_at
    INTO _booking FROM public.class_bookings b JOIN public.classes c ON c.id = b.class_id WHERE b.id = _booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Booking not found or already cancelled'); END IF;

  IF auth.uid() IS NOT NULL THEN
    _caller_member := public.get_member_id(auth.uid());
    IF NOT public.can_manage_class_session(_booking.class_branch_id)
       AND (_caller_member IS NULL OR _caller_member <> _booking.member_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only cancel your own bookings');
    END IF;
  END IF;

  UPDATE public.class_bookings SET status = 'cancelled', cancelled_at = now(), cancellation_reason = _reason
   WHERE id = _booking_id AND status = 'booked';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Booking not found or already cancelled'); END IF;

  IF _booking.class_scheduled_at > now() THEN
    _released := public._release_class_benefit_usage(_booking_id);
  END IF;

  UPDATE public.invoices inv SET status = 'cancelled', updated_at = now()
   WHERE inv.member_id = _booking.member_id AND inv.status IN ('pending','overdue')
     AND COALESCE(inv.amount_paid,0) = 0
     AND EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.invoice_id = inv.id
                  AND ii.reference_type = 'class_booking' AND ii.reference_id::text = _booking.class_id::text)
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = inv.id AND p.status = 'completed');
  GET DIAGNOSTICS _inv_cancelled = ROW_COUNT;

  SELECT * INTO _class FROM public.classes WHERE id = _booking.class_id;
  SELECT * INTO _next_waitlist FROM public.class_waitlist WHERE class_id = _booking.class_id ORDER BY position LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.class_bookings (class_id, member_id, status, booked_at, cancelled_at, cancellation_reason, was_waitlisted)
    VALUES (_booking.class_id, _next_waitlist.member_id, 'booked', now(), NULL, NULL, true)
    ON CONFLICT (class_id, member_id) DO UPDATE
       SET status = 'booked', booked_at = now(), cancelled_at = NULL, cancellation_reason = NULL, was_waitlisted = true
     WHERE public.class_bookings.status <> 'booked';
    _promoted := true;
    UPDATE public.class_waitlist SET notified_at = now() WHERE id = _next_waitlist.id;
    DELETE FROM public.class_waitlist WHERE id = _next_waitlist.id;
    UPDATE public.class_waitlist SET position = position - 1
     WHERE class_id = _booking.class_id AND position > _next_waitlist.position;

    -- Bill the promoted member for a paid class exactly like a direct booking (reuse any open invoice).
    IF COALESCE(_class.price, 0) > 0 THEN
      SELECT inv.id INTO _promo_invoice FROM public.invoices inv JOIN public.invoice_items ii ON ii.invoice_id = inv.id
       WHERE inv.member_id = _next_waitlist.member_id AND ii.reference_type = 'class_booking'
         AND ii.reference_id::text = _class.id::text AND inv.status IN ('pending','partial','overdue','paid')
       ORDER BY (inv.status='paid') DESC, inv.created_at DESC LIMIT 1;
      IF _promo_invoice IS NULL THEN
        _val := public.validate_class_booking(_class.id, _next_waitlist.member_id);
        IF COALESCE(_val->>'mode', 'paid') = 'paid' THEN
          PERFORM set_config('app.trusted_invoice', 'true', true);
          _inv_res := public.create_manual_invoice(
            p_branch_id => _class.branch_id, p_member_id => _next_waitlist.member_id,
            p_items => jsonb_build_array(jsonb_build_object('description', 'Class: ' || _class.name, 'quantity', 1,
                'unit_price', _class.price, 'reference_type', 'class_booking', 'reference_id', _class.id::text)),
            p_due_date => CURRENT_DATE + INTERVAL '7 days', p_notes => 'Paid class booking (promoted from waitlist)',
            p_discount_amount => 0, p_include_gst => COALESCE(_class.gst_rate, 0) > 0,
            p_gst_rate => COALESCE(_class.gst_rate, 0), p_customer_gstin => NULL,
            p_gst_inclusive => COALESCE(_class.is_gst_inclusive, true));
          PERFORM set_config('app.trusted_invoice', 'false', true);
          IF NOT COALESCE((_inv_res->>'success')::boolean, false) THEN
            RAISE EXCEPTION 'invoice_failed: could not bill promoted waitlist member' USING ERRCODE = 'P0001';
          END IF;
          _promo_invoice := (_inv_res->>'invoice_id')::uuid;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'promoted_from_waitlist', _promoted, 'credit_released', _released > 0,
    'invoice_cancelled', _inv_cancelled > 0, 'promoted_invoice_id', _promo_invoice);
END;
$function$;