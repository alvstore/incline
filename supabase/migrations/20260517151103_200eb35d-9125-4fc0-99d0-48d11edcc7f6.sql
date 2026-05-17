-- Extend log_pt_session to also write a member_attendance row for today
-- (idempotent per day) so trainer marking PT = gym check-in.

CREATE OR REPLACE FUNCTION public.log_pt_session(
  p_member_pt_package_id uuid,
  p_trainer_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.member_pt_packages%ROWTYPE;
  v_session_id uuid;
  v_caller uuid := auth.uid();
  v_already_checked_in boolean;
BEGIN
  IF NOT public.has_any_role(v_caller, ARRAY['owner','admin','manager','trainer']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_pkg
    FROM public.member_pt_packages
    WHERE id = p_member_pt_package_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package_not_found';
  END IF;

  IF v_pkg.status <> 'active' THEN
    RAISE EXCEPTION 'package_not_active';
  END IF;

  IF v_pkg.package_type = 'session_based' THEN
    IF COALESCE(v_pkg.sessions_remaining, 0) <= 0 THEN
      RAISE EXCEPTION 'no_sessions_left';
    END IF;
  ELSIF v_pkg.package_type = 'monthly' THEN
    IF CURRENT_DATE > v_pkg.expiry_date THEN
      RAISE EXCEPTION 'package_expired';
    END IF;
  END IF;

  -- Insert the PT session (always)
  INSERT INTO public.pt_sessions (
    member_pt_package_id, trainer_id, branch_id,
    scheduled_at, status, notes, duration_minutes
  ) VALUES (
    v_pkg.id, p_trainer_id, v_pkg.branch_id,
    now(), 'completed', p_notes, 60
  ) RETURNING id INTO v_session_id;

  -- Decrement session counter for session-based packs
  IF v_pkg.package_type = 'session_based' THEN
    UPDATE public.member_pt_packages
      SET sessions_used = COALESCE(sessions_used, 0) + 1,
          sessions_remaining = GREATEST(0, COALESCE(sessions_remaining, 0) - 1),
          status = CASE
            WHEN COALESCE(sessions_remaining, 0) - 1 <= 0 THEN 'completed'::pt_package_status
            ELSE status
          END,
          updated_at = now()
      WHERE id = v_pkg.id
      RETURNING sessions_remaining INTO v_pkg.sessions_remaining;
  END IF;

  -- Also create a gym check-in for today if the member doesn't already have one.
  -- This way trainer marking PT counts as the member's daily attendance.
  SELECT EXISTS (
    SELECT 1 FROM public.member_attendance
    WHERE member_id = v_pkg.member_id
      AND check_in::date = CURRENT_DATE
  ) INTO v_already_checked_in;

  IF NOT v_already_checked_in THEN
    BEGIN
      INSERT INTO public.member_attendance (
        member_id, branch_id, check_in, check_in_method, notes
      ) VALUES (
        v_pkg.member_id, v_pkg.branch_id, now(), 'pt_session',
        'Auto check-in via PT session ' || v_session_id::text
      );
    EXCEPTION WHEN OTHERS THEN
      -- never block session logging on attendance failure
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'member_id', v_pkg.member_id,
    'branch_id', v_pkg.branch_id,
    'package_type', v_pkg.package_type,
    'sessions_remaining', v_pkg.sessions_remaining,
    'expiry_date', v_pkg.expiry_date,
    'gym_check_in_created', NOT v_already_checked_in
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_pt_session(uuid, uuid, text) TO authenticated;