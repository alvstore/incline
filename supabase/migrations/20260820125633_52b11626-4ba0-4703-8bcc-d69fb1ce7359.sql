
-- Migration: PT Attendance Hardening & Historical Manual Sync
-- v1.0.0

CREATE OR REPLACE FUNCTION public.log_pt_session(
    p_member_pt_package_id uuid, 
    p_trainer_id uuid, 
    p_status text DEFAULT 'completed'::text, 
    p_notes text DEFAULT NULL::text, 
    p_session_id uuid DEFAULT NULL::uuid,
    p_session_date date DEFAULT CURRENT_DATE
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg public.member_pt_packages%ROWTYPE;
  v_session_id uuid;
  v_caller uuid := auth.uid();
  v_already_checked_in boolean;
  v_status public.pt_session_status;
  v_consumes_session boolean;
  v_creates_checkin boolean;
  v_is_manager boolean;
  v_caller_trainer_id uuid;
  v_member_checked_in boolean;
  v_trainer_checked_in boolean;
  v_trainer_user_id uuid;
BEGIN
  v_is_manager := public.has_any_role(v_caller, ARRAY['owner','admin','manager']::app_role[]);

  IF NOT v_is_manager
     AND NOT public.has_any_role(v_caller, ARRAY['trainer']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  v_status := CASE lower(coalesce(p_status, 'completed'))
    WHEN 'present'   THEN 'completed'::public.pt_session_status
    WHEN 'completed' THEN 'completed'::public.pt_session_status
    WHEN 'late'      THEN 'late'::public.pt_session_status
    WHEN 'absent'    THEN 'absent'::public.pt_session_status
    WHEN 'holiday'   THEN 'holiday'::public.pt_session_status
    ELSE NULL
  END;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  v_consumes_session := v_status IN ('completed','late','absent');
  v_creates_checkin  := v_status IN ('completed','late');

  SELECT * INTO v_pkg FROM public.member_pt_packages WHERE id = p_member_pt_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'package_not_found'; END IF;
  IF v_pkg.status <> 'active' THEN RAISE EXCEPTION 'package_not_active'; END IF;

  -- Ownership guard: a plain trainer can only mark their own assigned clients
  IF NOT v_is_manager THEN
    SELECT id INTO v_caller_trainer_id FROM public.trainers WHERE user_id = v_caller LIMIT 1;
    IF v_caller_trainer_id IS NULL OR v_pkg.trainer_id IS DISTINCT FROM v_caller_trainer_id THEN
      RAISE EXCEPTION 'not_your_client';
    END IF;
    p_trainer_id := v_caller_trainer_id;
  END IF;

  p_trainer_id := COALESCE(p_trainer_id, v_pkg.trainer_id);
  
  -- Get trainer's user_id for staff attendance check
  SELECT user_id INTO v_trainer_user_id FROM public.trainers WHERE id = p_trainer_id;

  IF v_consumes_session
     AND v_pkg.start_date IS NOT NULL
     AND p_session_date < v_pkg.start_date THEN
    RAISE EXCEPTION 'package_not_started_%', to_char(v_pkg.start_date, 'DD Mon YYYY');
  END IF;
  
  -- Safety Window: Max 7 days backdated sessions
  IF p_session_date < CURRENT_DATE - INTERVAL '7 days' THEN
    RAISE EXCEPTION 'session_date_too_old';
  END IF;
  
  -- Attendance Verification for 'present'/'completed'/'late'
  -- Must ensure both are in the gym to prevent cheating.
  IF v_creates_checkin THEN
    -- Check member attendance for that date
    SELECT EXISTS (
      SELECT 1 FROM public.member_attendance 
      WHERE member_id = v_pkg.member_id AND check_in::date = p_session_date
    ) INTO v_member_checked_in;
    
    -- Check trainer attendance for that date
    SELECT EXISTS (
      SELECT 1 FROM public.staff_attendance 
      WHERE user_id = v_trainer_user_id AND check_in::date = p_session_date
    ) INTO v_trainer_checked_in;
    
    IF NOT v_member_checked_in OR NOT v_trainer_checked_in THEN
      RAISE EXCEPTION 'insufficient_gym_attendance';
    END IF;
  END IF;

  IF v_pkg.package_type = 'session_based' AND v_consumes_session THEN
    IF COALESCE(v_pkg.sessions_remaining, 0) <= 0 THEN RAISE EXCEPTION 'no_sessions_left'; END IF;
  ELSIF v_pkg.package_type = 'monthly' AND v_consumes_session THEN
    IF p_session_date > v_pkg.expiry_date THEN RAISE EXCEPTION 'package_expired'; END IF;
  END IF;

  IF p_session_id IS NOT NULL THEN
    UPDATE public.pt_sessions
       SET status = v_status,
           notes = COALESCE(p_notes, notes),
           scheduled_at = p_session_date + (scheduled_at::time),
           updated_at = now()
     WHERE id = p_session_id
       AND status = 'scheduled'::public.pt_session_status
     RETURNING id INTO v_session_id;
    IF v_session_id IS NULL THEN
      RAISE EXCEPTION 'session_not_scheduled';
    END IF;
  ELSE
    INSERT INTO public.pt_sessions (
      member_pt_package_id, trainer_id, branch_id,
      scheduled_at, status, notes, duration_minutes
    ) VALUES (
      v_pkg.id, p_trainer_id, v_pkg.branch_id, 
      (p_session_date + CURRENT_TIME), -- Use specific date + current time for logging
      v_status, p_notes, 60
    ) RETURNING id INTO v_session_id;
  END IF;

  IF v_pkg.package_type = 'session_based' AND v_consumes_session THEN
    UPDATE public.member_pt_packages
      SET sessions_used = COALESCE(sessions_used, 0) + 1,
          sessions_remaining = GREATEST(0, COALESCE(sessions_remaining, 0) - 1),
          status = CASE
            WHEN COALESCE(sessions_remaining, 0) - 1 <= 0 THEN 'exhausted'::pt_package_status
            ELSE status
          END,
          updated_at = now()
      WHERE id = v_pkg.id
      RETURNING sessions_remaining INTO v_pkg.sessions_remaining;
  END IF;

  -- Auto check-in only for today
  IF v_creates_checkin AND p_session_date = CURRENT_DATE THEN
    SELECT EXISTS (
      SELECT 1 FROM public.member_attendance
      WHERE member_id = v_pkg.member_id AND check_in::date = CURRENT_DATE
    ) INTO v_already_checked_in;

    IF NOT v_already_checked_in THEN
      BEGIN
        INSERT INTO public.member_attendance (
          member_id, branch_id, check_in, check_in_method, notes
        ) VALUES (
          v_pkg.member_id, v_pkg.branch_id, now(), 'pt_session',
          'Auto check-in via PT session ' || v_session_id::text
        );
      EXCEPTION WHEN OTHERS THEN NULL;
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
    'gym_check_in_created', (v_creates_checkin AND p_session_date = CURRENT_DATE AND NOT v_already_checked_in)
  );
END;
$function$;
