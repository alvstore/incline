CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid, _member_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _validation jsonb; _mode text; _membership_id uuid; _class RECORD;
  _booking_id uuid; _invoice_result jsonb; _invoice_id uuid; _caller_member uuid;
BEGIN
  SELECT * INTO _class FROM public.classes WHERE id = _class_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'not_found', 'error', 'Class not found'); END IF;

  IF auth.uid() IS NOT NULL THEN
    _caller_member := public.get_member_id(auth.uid());
    IF NOT public.can_manage_class_session(_class.branch_id)
       AND (_caller_member IS NULL OR _caller_member <> _member_id) THEN
      RETURN jsonb_build_object('success', false, 'code', 'forbidden', 'error', 'You can only book classes for yourself');
    END IF;
  END IF;
  IF _class.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'class_cancelled', 'error', 'This class has been cancelled');
  END IF;

  -- Serialize concurrent attempts for the same member + class (double taps, two desks).
  PERFORM pg_advisory_xact_lock(hashtextextended(_class_id::text || ':' || _member_id::text, 0));

  IF EXISTS (SELECT 1 FROM public.class_bookings WHERE class_id=_class_id AND member_id=_member_id AND status IN ('booked','attended')) THEN
    RETURN jsonb_build_object('success', true, 'already_booked', true, 'code', 'already_booked',
      'booking_id', (SELECT id FROM public.class_bookings WHERE class_id=_class_id AND member_id=_member_id));
  END IF;

  _validation := public.validate_class_booking(_class_id, _member_id);
  IF NOT (_validation->>'valid')::boolean THEN
    RETURN _validation || jsonb_build_object('success', false,
      'code', CASE WHEN COALESCE((_validation->>'waitlist_available')::boolean,false) THEN 'class_full' ELSE 'not_eligible' END);
  END IF;
  _mode := COALESCE(_validation->>'mode', 'free');
  _membership_id := (_validation->>'membership_id')::uuid;

  -- 1) Booking first.
  INSERT INTO public.class_bookings (class_id, member_id, status, booked_at, cancelled_at, cancellation_reason, attended_at, no_show_reason)
  VALUES (_class_id, _member_id, 'booked', now(), NULL, NULL, NULL, NULL)
  ON CONFLICT (class_id, member_id) DO UPDATE
     SET status = 'booked', booked_at = now(), cancelled_at = NULL, cancellation_reason = NULL, attended_at = NULL, no_show_reason = NULL
   WHERE public.class_bookings.status IN ('cancelled', 'waitlisted')
  RETURNING id INTO _booking_id;
  IF _booking_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'already_booked', true, 'code', 'already_booked');
  END IF;

  -- 2) Invoice second; reuse an open unpaid one for this class/member. Any failure rolls everything back.
  IF _mode = 'paid' AND _class.price > 0 THEN
    SELECT inv.id INTO _invoice_id FROM public.invoices inv JOIN public.invoice_items ii ON ii.invoice_id = inv.id
     WHERE inv.member_id = _member_id AND ii.reference_type = 'class_booking' AND ii.reference_id::text = _class_id::text
       AND inv.status IN ('pending','partial','overdue','paid')
     ORDER BY (inv.status='paid') DESC, inv.created_at DESC LIMIT 1;
    IF _invoice_id IS NULL THEN
      PERFORM set_config('app.trusted_invoice', 'true', true);
      _invoice_result := public.create_manual_invoice(
        p_branch_id => _class.branch_id, p_member_id => _member_id,
        p_items => jsonb_build_array(jsonb_build_object('description', 'Class: ' || _class.name, 'quantity', 1,
          'unit_price', _class.price, 'reference_type', 'class_booking', 'reference_id', _class_id::text)),
        p_due_date => CURRENT_DATE + INTERVAL '7 days', p_notes => 'Workshop / paid class booking',
        p_discount_amount => 0, p_include_gst => COALESCE(_class.gst_rate, 0) > 0,
        p_gst_rate => COALESCE(_class.gst_rate, 0), p_customer_gstin => NULL,
        p_gst_inclusive => COALESCE(_class.is_gst_inclusive, true));
      PERFORM set_config('app.trusted_invoice', 'false', true);
      IF NOT COALESCE((_invoice_result->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'invoice_failed: could not create invoice for paid class' USING ERRCODE = 'P0001';
      END IF;
      _invoice_id := (_invoice_result->>'invoice_id')::uuid;
    END IF;
  END IF;

  IF _mode = 'benefit' AND _class.benefit_type_id IS NOT NULL THEN
    INSERT INTO public.benefit_usage (membership_id, benefit_type, benefit_type_id, usage_date, usage_count, notes, recorded_by, source_meta)
    VALUES (_membership_id, 'group_classes', _class.benefit_type_id, CURRENT_DATE, 1, 'Class: ' || _class.name, auth.uid(),
            jsonb_build_object('kind', 'class_booking', 'class_booking_id', _booking_id, 'class_id', _class_id));
  END IF;

  RETURN jsonb_build_object('success', true, 'code', 'booked', 'booking_id', _booking_id, 'mode', _mode, 'invoice_id', _invoice_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_class_booking(_booking_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _booking RECORD; _next_waitlist RECORD; _caller_member uuid;
  _promoted boolean := false; _released integer := 0; _inv_cancelled integer := 0;
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

  -- Cancel the still-unpaid class invoice (no money received) so no reminder goes out.
  UPDATE public.invoices inv SET status = 'cancelled', updated_at = now()
   WHERE inv.member_id = _booking.member_id AND inv.status IN ('pending','overdue')
     AND COALESCE(inv.amount_paid,0) = 0
     AND EXISTS (SELECT 1 FROM public.invoice_items ii WHERE ii.invoice_id = inv.id
                  AND ii.reference_type = 'class_booking' AND ii.reference_id::text = _booking.class_id::text)
     AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.invoice_id = inv.id AND p.status = 'completed');
  GET DIAGNOSTICS _inv_cancelled = ROW_COUNT;

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
  END IF;

  RETURN jsonb_build_object('success', true, 'promoted_from_waitlist', _promoted, 'credit_released', _released > 0, 'invoice_cancelled', _inv_cancelled > 0);
END;
$function$;