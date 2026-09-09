
-- 1) PROFILES: block privileged self-edits -------------------------------
CREATE OR REPLACE FUNCTION public.tg_profiles_block_privileged_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / triggers
  END IF;
  IF public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.government_id_verified IS DISTINCT FROM OLD.government_id_verified
     OR NEW.government_id_number IS DISTINCT FROM OLD.government_id_number
     OR NEW.must_set_password IS DISTINCT FROM OLD.must_set_password
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
  THEN
    RAISE EXCEPTION 'Not allowed to modify protected account fields';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_block_privileged_self_update ON public.profiles;
CREATE TRIGGER trg_profiles_block_privileged_self_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_block_privileged_self_update();

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- 2) BIOMETRIC PHOTO INTEGRITY -------------------------------------------
-- Writes to the biometric bucket are staff-only: a person may READ their own
-- face photo, but may never set/replace it (that would let anyone enrol
-- someone else's face and walk in).
CREATE OR REPLACE FUNCTION public.can_write_biometric_photo(_user_id uuid, _path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_first text := split_part(coalesce(_path, ''), '/', 1);
  v_kind  text := split_part(coalesce(_path, ''), '/', 2);
  v_id    uuid;
  v_branch uuid;
BEGIN
  IF v_first <> 'biometric' THEN RETURN false; END IF;

  IF public.has_any_role(_user_id, ARRAY['owner','admin']::public.app_role[]) THEN
    RETURN true;
  END IF;

  -- Only branch staff may write; members/trainers writing their own file is denied.
  IF NOT public.has_any_role(_user_id, ARRAY['manager','staff']::public.app_role[]) THEN
    RETURN false;
  END IF;

  BEGIN
    v_id := split_part(split_part(_path, '/', 3), '.', 1)::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  IF v_kind = 'members' THEN
    SELECT m.branch_id INTO v_branch FROM public.members m WHERE m.id = v_id;
  ELSIF v_kind = 'trainers' THEN
    SELECT t.branch_id INTO v_branch FROM public.trainers t WHERE t.id = v_id;
  ELSIF v_kind = 'employees' THEN
    SELECT e.branch_id INTO v_branch FROM public.employees e WHERE e.id = v_id;
  ELSE
    RETURN false;
  END IF;

  IF v_branch IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.user_visible_branch_ids(_user_id) b(id) WHERE b.id = v_branch
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_write_biometric_photo(uuid, text) TO authenticated, service_role;

-- Row-level guard: the face photo columns are staff-only too.
CREATE OR REPLACE FUNCTION public.tg_guard_biometric_photo_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_changed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / background workers
  END IF;

  v_changed :=
    (row_to_json(NEW)->>'biometric_photo_path') IS DISTINCT FROM (row_to_json(OLD)->>'biometric_photo_path')
    OR (row_to_json(NEW)->>'biometric_photo_url') IS DISTINCT FROM (row_to_json(OLD)->>'biometric_photo_url');

  IF NOT v_changed THEN RETURN NEW; END IF;

  IF public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[]) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Face photos can only be set by gym staff';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_biometric_photo_members ON public.members;
CREATE TRIGGER trg_guard_biometric_photo_members
BEFORE UPDATE OF biometric_photo_path, biometric_photo_url ON public.members
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_biometric_photo_write();

DROP TRIGGER IF EXISTS trg_guard_biometric_photo_trainers ON public.trainers;
CREATE TRIGGER trg_guard_biometric_photo_trainers
BEFORE UPDATE OF biometric_photo_path, biometric_photo_url ON public.trainers
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_biometric_photo_write();

DROP TRIGGER IF EXISTS trg_guard_biometric_photo_employees ON public.employees;
CREATE TRIGGER trg_guard_biometric_photo_employees
BEFORE UPDATE OF biometric_photo_path, biometric_photo_url ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_biometric_photo_write();

-- 3) LAST-EXIT-WINS CHECKOUT ----------------------------------------------
CREATE OR REPLACE FUNCTION public.member_gate_check_out(_member_id uuid, _branch_id uuid, _at timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.member_attendance%ROWTYPE;
BEGIN
  -- Open visit first.
  SELECT * INTO _row
  FROM public.member_attendance
  WHERE member_id = _member_id AND check_out IS NULL AND check_in <= _at
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    IF _at - _row.check_in < interval '1 minute' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Exit scan too close to entry scan; ignored');
    END IF;

    UPDATE public.member_attendance
    SET check_out = _at, check_out_method = 'biometric'
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  -- LAST EXIT WINS: members often scan out at reception and then head to the
  -- training floor. A later exit scan on the same visit extends the checkout
  -- instead of being discarded.
  SELECT * INTO _row
  FROM public.member_attendance
  WHERE member_id = _member_id
    AND check_out IS NOT NULL
    AND check_in <= _at
    AND _at - check_out <= interval '4 hours'
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND _at > _row.check_out THEN
    UPDATE public.member_attendance
    SET check_out = _at, check_out_method = 'biometric'
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id, 'extended', true,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  RETURN jsonb_build_object('success', false, 'message', 'No open visit to close');
END;
$$;

DROP FUNCTION IF EXISTS public.staff_gate_check_out(uuid, uuid, timestamp with time zone);
CREATE OR REPLACE FUNCTION public.staff_gate_check_out(_staff_id uuid, _branch_id uuid, _at timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.staff_attendance%ROWTYPE;
BEGIN
  SELECT * INTO _row
  FROM public.staff_attendance
  WHERE employee_id = _staff_id AND check_out IS NULL AND check_in <= _at
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    IF _at - _row.check_in < interval '1 minute' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Exit scan too close to entry scan; ignored');
    END IF;

    UPDATE public.staff_attendance
    SET check_out = _at,
        total_hours = ROUND(EXTRACT(EPOCH FROM (_at - _row.check_in))/3600.0, 2)
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  SELECT * INTO _row
  FROM public.staff_attendance
  WHERE employee_id = _staff_id
    AND check_out IS NOT NULL
    AND check_in <= _at
    AND _at - check_out <= interval '4 hours'
  ORDER BY check_in DESC LIMIT 1 FOR UPDATE;

  IF FOUND AND _at > _row.check_out THEN
    UPDATE public.staff_attendance
    SET check_out = _at,
        total_hours = ROUND(EXTRACT(EPOCH FROM (_at - _row.check_in))/3600.0, 2)
    WHERE id = _row.id;

    RETURN jsonb_build_object('success', true, 'attendance_id', _row.id, 'extended', true,
      'check_in', _row.check_in, 'check_out', _at,
      'duration_minutes', EXTRACT(EPOCH FROM (_at - _row.check_in))/60);
  END IF;

  RETURN jsonb_build_object('success', false, 'message', 'No open shift to close');
END;
$$;

-- 4) Slow the gate-facing background jobs ---------------------------------
UPDATE public.automation_rules SET cron_expression = '*/30 * * * *' WHERE key = 'mips_face_enrollment_sweep';
UPDATE public.automation_rules SET cron_expression = '0 */2 * * *'  WHERE key = 'mips_reconcile_devices';
UPDATE public.automation_rules SET cron_expression = '0 * * * *'    WHERE key = 'biometric_photo_sweep';
UPDATE public.automation_rules SET cron_expression = '*/15 * * * *' WHERE key = 'process_biometric_sync_queue';
