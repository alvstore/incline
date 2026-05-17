-- Extend pt_session_status with new values used by trainer attendance
ALTER TYPE public.pt_session_status ADD VALUE IF NOT EXISTS 'absent';
ALTER TYPE public.pt_session_status ADD VALUE IF NOT EXISTS 'holiday';
ALTER TYPE public.pt_session_status ADD VALUE IF NOT EXISTS 'late';

-- New overload of log_pt_session that accepts a status. The old 3-arg
-- signature is dropped so all callers go through the same code path.
DROP FUNCTION IF EXISTS public.log_pt_session(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.log_pt_session(
  p_member_pt_package_id uuid,
  p_trainer_id uuid,
  p_status text DEFAULT 'completed',
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
  v_status public.pt_session_status;
  v_consumes_session boolean;
  v_creates_checkin boolean;
BEGIN
  IF NOT public.has_any_role(v_caller, ARRAY['owner','admin','manager','trainer']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  -- Normalize/validate status. 'present' is an alias for 'completed'.
  v_status := CASE lower(coalesce(p_status, 'completed'))
    WHEN 'present'  THEN 'completed'::public.pt_session_status
    WHEN 'completed' THEN 'completed'::public.pt_session_status
    WHEN 'late'     THEN 'late'::public.pt_session_status
    WHEN 'absent'   THEN 'absent'::public.pt_session_status
    WHEN 'holiday'  THEN 'holiday'::public.pt_session_status
    ELSE NULL
  END;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  -- Holiday does NOT consume the pack and does NOT create a gym check-in.
  -- Absent consumes the session (member no-show on a booked slot) but does
  -- NOT create a gym check-in. Present/Late do both.
  v_consumes_session := v_status IN ('completed','late','absent');
  v_creates_checkin  := v_status IN ('completed','late');

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

  IF v_pkg.package_type = 'session_based' AND v_consumes_session THEN
    IF COALESCE(v_pkg.sessions_remaining, 0) <= 0 THEN
      RAISE EXCEPTION 'no_sessions_left';
    END IF;
  ELSIF v_pkg.package_type = 'monthly' AND v_consumes_session THEN
    IF CURRENT_DATE > v_pkg.expiry_date THEN
      RAISE EXCEPTION 'package_expired';
    END IF;
  END IF;

  INSERT INTO public.pt_sessions (
    member_pt_package_id, trainer_id, branch_id,
    scheduled_at, status, notes, duration_minutes
  ) VALUES (
    v_pkg.id, p_trainer_id, v_pkg.branch_id,
    now(), v_status, p_notes, 60
  ) RETURNING id INTO v_session_id;

  IF v_pkg.package_type = 'session_based' AND v_consumes_session THEN
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

  IF v_creates_checkin THEN
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
        NULL;
      END;
    END IF;
  ELSE
    v_already_checked_in := true;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'member_id', v_pkg.member_id,
    'branch_id', v_pkg.branch_id,
    'package_type', v_pkg.package_type,
    'status', v_status,
    'sessions_remaining', v_pkg.sessions_remaining,
    'expiry_date', v_pkg.expiry_date,
    'gym_check_in_created', (v_creates_checkin AND NOT v_already_checked_in)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_pt_session(uuid, uuid, text, text) TO authenticated;
