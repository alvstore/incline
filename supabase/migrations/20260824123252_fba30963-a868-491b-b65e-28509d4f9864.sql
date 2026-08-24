CREATE OR REPLACE FUNCTION public.mark_class_attendance(
  _booking_id UUID,
  _attended BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _booking RECORD;
  _membership RECORD;
BEGIN
  UPDATE class_bookings
  SET status = (CASE WHEN _attended THEN 'attended' ELSE 'no_show' END)::class_booking_status,
      attended_at = CASE WHEN _attended THEN now() ELSE NULL END
  WHERE id = _booking_id AND status = 'booked'::class_booking_status
  RETURNING * INTO _booking;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found or not in booked status');
  END IF;

  IF _attended THEN
    SELECT m.* INTO _membership FROM memberships m
    WHERE m.member_id = _booking.member_id
      AND m.status = 'active'
    ORDER BY m.end_date DESC LIMIT 1;

    IF FOUND THEN
      INSERT INTO benefit_usage (membership_id, benefit_type, usage_date, usage_count)
      VALUES (_membership.id, 'group_classes', CURRENT_DATE, 1);
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', CASE WHEN _attended THEN 'attended' ELSE 'no_show' END);
END;
$$;