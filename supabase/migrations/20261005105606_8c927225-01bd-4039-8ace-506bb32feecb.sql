CREATE OR REPLACE FUNCTION public.book_class(_class_id uuid, _member_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _validation jsonb;
  _mode text;
  _membership_id uuid;
  _class RECORD;
  _booking_id uuid;
  _invoice_result jsonb;
  _invoice_id uuid;
  _caller_member uuid;
BEGIN
  SELECT * INTO _class FROM public.classes WHERE id = _class_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Class not found');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    _caller_member := public.get_member_id(auth.uid());
    IF NOT public.can_manage_class_session(_class.branch_id)
       AND (_caller_member IS NULL OR _caller_member <> _member_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'You can only book classes for yourself');
    END IF;
  END IF;

  IF _class.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This class has been cancelled');
  END IF;

  _validation := public.validate_class_booking(_class_id, _member_id);
  IF NOT (_validation->>'valid')::boolean THEN
    RETURN _validation;
  END IF;

  _mode := COALESCE(_validation->>'mode', 'free');
  _membership_id := (_validation->>'membership_id')::uuid;

  IF _mode = 'paid' AND _class.price > 0 THEN
    -- Server-priced invoice: mark as trusted so member-pricing triggers don't reject the class line.
    PERFORM set_config('app.trusted_invoice', 'true', true);
    _invoice_result := public.create_manual_invoice(
      p_branch_id => _class.branch_id,
      p_member_id => _member_id,
      p_items => jsonb_build_array(jsonb_build_object(
        'description', 'Class: ' || _class.name,
        'quantity', 1,
        'unit_price', _class.price,
        'reference_type', 'class_booking',
        'reference_id', _class_id::text
      )),
      p_due_date => CURRENT_DATE + INTERVAL '7 days',
      p_notes => 'Workshop / paid class booking',
      p_discount_amount => 0,
      p_include_gst => COALESCE(_class.gst_rate, 0) > 0,
      p_gst_rate => COALESCE(_class.gst_rate, 0),
      p_customer_gstin => NULL,
      p_gst_inclusive => COALESCE(_class.is_gst_inclusive, true)
    );
    PERFORM set_config('app.trusted_invoice', 'false', true);
    IF NOT COALESCE((_invoice_result->>'success')::boolean, false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Failed to create invoice for paid class');
    END IF;
    _invoice_id := (_invoice_result->>'invoice_id')::uuid;
  END IF;

  INSERT INTO public.class_bookings (class_id, member_id, status, booked_at, cancelled_at, cancellation_reason, attended_at, no_show_reason)
  VALUES (_class_id, _member_id, 'booked', now(), NULL, NULL, NULL, NULL)
  ON CONFLICT (class_id, member_id) DO UPDATE
     SET status = 'booked', booked_at = now(), cancelled_at = NULL, cancellation_reason = NULL, attended_at = NULL, no_show_reason = NULL
   WHERE public.class_bookings.status IN ('cancelled', 'waitlisted')
  RETURNING id INTO _booking_id;

  IF _booking_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already booked for this class');
  END IF;

  IF _mode = 'benefit' AND _class.benefit_type_id IS NOT NULL THEN
    INSERT INTO public.benefit_usage (membership_id, benefit_type, benefit_type_id, usage_date, usage_count, notes, recorded_by, source_meta)
    VALUES (_membership_id, 'group_classes', _class.benefit_type_id, CURRENT_DATE, 1, 'Class: ' || _class.name, auth.uid(),
            jsonb_build_object('kind', 'class_booking', 'class_booking_id', _booking_id, 'class_id', _class_id));
  END IF;

  RETURN jsonb_build_object('success', true, 'booking_id', _booking_id, 'mode', _mode, 'invoice_id', _invoice_id);
END;
$function$;