-- 1) Merge HOWBODY body-composition scan into an existing measurement row for the same scan window
CREATE OR REPLACE FUNCTION public.howbody_mirror_body_to_measurements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recorded_at timestamptz := COALESCE(NEW.test_time, NEW.created_at, now());
  v_height numeric := NULLIF(NEW.full_payload->>'height', '')::numeric;
  v_existing_id uuid;
BEGIN
  -- Body + posture reports for the same scan session arrive minutes apart.
  -- Merge them into a single measurement row so the UI shows one complete entry.
  SELECT id INTO v_existing_id
  FROM public.member_measurements
  WHERE member_id = NEW.member_id
    AND notes LIKE 'HOWBODY auto-sync%'
    AND recorded_at BETWEEN v_recorded_at - interval '2 hours' AND v_recorded_at + interval '2 hours'
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.member_measurements
    SET weight_kg = COALESCE(NEW.weight, weight_kg),
        body_fat_percentage = COALESCE(NEW.pbf, body_fat_percentage),
        height_cm = COALESCE(v_height, height_cm),
        recorded_at = LEAST(recorded_at, v_recorded_at),
        notes = 'HOWBODY auto-sync (body composition + posture)',
        updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.member_measurements
      (member_id, recorded_at, weight_kg, height_cm, body_fat_percentage, notes)
    VALUES
      (NEW.member_id, v_recorded_at, NEW.weight, v_height, NEW.pbf, 'HOWBODY auto-sync (body composition)');
  END IF;

  PERFORM public.consume_scan_credit_if_needed(NEW.member_id, 'body');
  RETURN NEW;
END;
$$;

-- 2) Merge HOWBODY posture scan into the same measurement row
CREATE OR REPLACE FUNCTION public.howbody_mirror_posture_to_measurements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recorded_at timestamptz := COALESCE(NEW.test_time, NEW.created_at, now());
  v_height numeric := NULLIF(NEW.full_payload->>'height', '')::numeric;
  v_posture_summary text;
  v_existing_id uuid;
BEGIN
  v_posture_summary := CASE
    WHEN ABS(COALESCE(NEW.head_forward,0)) > 5 THEN 'Forward head posture'
    WHEN ABS(COALESCE(NEW.high_low_shoulder,0)) > 1 THEN 'Uneven shoulders'
    WHEN ABS(COALESCE(NEW.pelvis_forward,0)) > 5 THEN 'Anterior pelvic tilt'
    ELSE 'Neutral / balanced'
  END;

  SELECT id INTO v_existing_id
  FROM public.member_measurements
  WHERE member_id = NEW.member_id
    AND notes LIKE 'HOWBODY auto-sync%'
    AND recorded_at BETWEEN v_recorded_at - interval '2 hours' AND v_recorded_at + interval '2 hours'
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.member_measurements
    SET posture_type = v_posture_summary,
        waist_cm = COALESCE(NEW.waist, waist_cm),
        hips_cm = COALESCE(NEW.hip, hips_cm),
        chest_cm = COALESCE(NEW.bust, chest_cm),
        height_cm = COALESCE(height_cm, v_height),
        recorded_at = LEAST(recorded_at, v_recorded_at),
        notes = 'HOWBODY auto-sync (body composition + posture)',
        updated_at = now()
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO public.member_measurements
      (member_id, recorded_at, posture_type, notes, waist_cm, hips_cm, chest_cm, height_cm)
    VALUES
      (NEW.member_id, v_recorded_at, v_posture_summary,
       'HOWBODY auto-sync (posture)',
       NEW.waist, NEW.hip, NEW.bust, v_height);
  END IF;

  PERFORM public.consume_scan_credit_if_needed(NEW.member_id, 'posture');
  RETURN NEW;
END;
$$;

-- 3) Inactive members must lose gate access, same as suspended/blacklisted
CREATE OR REPLACE FUNCTION public.evaluate_member_access_state(
  p_member_id uuid,
  p_actor_user_id uuid DEFAULT auth.uid(),
  p_reason text DEFAULT NULL::text,
  p_force_sync boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.members%ROWTYPE;
  v_branch_settings public.branch_settings%ROWTYPE;
  v_has_active_membership boolean := false;
  v_has_frozen_membership boolean := false;
  v_has_overdue boolean := false;
  v_new_status text := 'none';
  v_previous_status text;
  v_requires_sync boolean := false;
BEGIN
  SELECT * INTO v_member FROM public.members WHERE id = p_member_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Member not found');
  END IF;

  SELECT * INTO v_branch_settings FROM public.branch_settings WHERE branch_id = v_member.branch_id;

  SELECT EXISTS (
    SELECT 1 FROM public.memberships ms
    WHERE ms.member_id = p_member_id
      AND ms.status = 'active'::public.membership_status
      AND ms.start_date <= current_date
      AND ms.end_date >= current_date
  ) INTO v_has_active_membership;

  SELECT EXISTS (
    SELECT 1 FROM public.memberships ms
    WHERE ms.member_id = p_member_id
      AND ms.status = 'frozen'::public.membership_status
      AND ms.start_date <= current_date
      AND COALESCE(ms.end_date, current_date) >= current_date
  ) INTO v_has_frozen_membership;

  v_has_overdue := (public.member_access_status(p_member_id, v_member.branch_id) ->> 'allowed')::boolean IS FALSE;

  v_previous_status := COALESCE(v_member.hardware_access_status, 'none');

  IF v_member.status IN ('suspended'::public.member_status, 'blacklisted'::public.member_status, 'inactive'::public.member_status) THEN
    v_new_status := 'blocked_member_status';
  ELSIF v_has_frozen_membership THEN
    v_new_status := 'frozen';
  ELSIF COALESCE(v_branch_settings.block_access_on_overdue, true) AND v_has_overdue THEN
    v_new_status := 'blocked_overdue';
  ELSIF v_has_active_membership THEN
    v_new_status := 'active';
  ELSE
    v_new_status := 'expired';
  END IF;

  IF v_new_status <> v_previous_status OR p_force_sync THEN
    v_requires_sync := true;
  END IF;

  UPDATE public.members
  SET hardware_access_status = v_new_status,
      hardware_access_reason = CASE
        WHEN v_new_status = 'blocked_overdue' THEN 'dues'
        WHEN v_new_status = 'frozen' THEN 'frozen'
        WHEN v_new_status = 'expired' THEN 'expired'
        WHEN v_new_status = 'blocked_member_status' THEN 'manual'
        ELSE NULL
      END,
      updated_at = now()
  WHERE id = p_member_id;

  IF v_requires_sync THEN
    INSERT INTO public.hardware_access_events (
      branch_id, member_id, actor_user_id, previous_status, new_status, reason, requires_sync
    ) VALUES (
      v_member.branch_id, p_member_id, p_actor_user_id, v_previous_status, v_new_status, p_reason, true
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'member_id', p_member_id,
    'previous_status', v_previous_status,
    'new_status', v_new_status,
    'requires_sync', v_requires_sync
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_member_access_state(uuid, uuid, text, boolean) TO authenticated;