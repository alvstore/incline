-- trainer_availability has is_available (not is_active); the old body raised 42703 on every call,
-- which made PT session scheduling always report "Trainer is not available".
CREATE OR REPLACE FUNCTION public.check_trainer_slot_available(_trainer_id uuid, _scheduled_at timestamp with time zone, _duration_minutes integer DEFAULT 60)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _day_of_week INTEGER;
  _time_slot TIME;
  _avail RECORD;
  _existing INT;
BEGIN
  -- Phase 1b guard: trainer themself, branch staff/trainers, or a member with an active PT package with this trainer
  IF public.rpc_guard_applies('check_trainer_slot_available') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.trainers t
      WHERE t.id = _trainer_id
        AND (
          t.user_id = auth.uid()
          OR public.is_branch_staff(t.branch_id, true)
          OR EXISTS (
            SELECT 1 FROM public.member_pt_packages mpp
            JOIN public.members m ON m.id = mpp.member_id
            WHERE mpp.trainer_id = t.id AND m.user_id = auth.uid()
              AND mpp.status::text = 'active'
          )
        )
    ) THEN
      RAISE EXCEPTION 'forbidden: check_trainer_slot_available' USING ERRCODE = '42501';
    END IF;
  END IF;

  _day_of_week := EXTRACT(DOW FROM _scheduled_at);
  _time_slot := _scheduled_at::TIME;

  -- Check if trainer has availability set for this day
  SELECT * INTO _avail FROM public.trainer_availability
  WHERE trainer_id = _trainer_id AND day_of_week = _day_of_week AND COALESCE(is_available, true) = true
  ORDER BY start_time
  LIMIT 1;

  IF FOUND THEN
    IF _time_slot < _avail.start_time OR _time_slot >= _avail.end_time THEN
      RETURN false;
    END IF;
  END IF;

  -- Check for existing sessions at this time
  SELECT COUNT(*) INTO _existing FROM public.pt_sessions
  WHERE trainer_id = _trainer_id
    AND status IN ('scheduled', 'completed')
    AND scheduled_at < _scheduled_at + (_duration_minutes || ' minutes')::INTERVAL
    AND scheduled_at + (COALESCE(duration_minutes, 60) || ' minutes')::INTERVAL > _scheduled_at;

  RETURN _existing = 0;
END;
$function$;
REVOKE ALL ON FUNCTION public.check_trainer_slot_available(uuid, timestamp with time zone, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_trainer_slot_available(uuid, timestamp with time zone, integer) TO authenticated, service_role;