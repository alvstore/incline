-- 1. Provenance columns
ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS recorded_by UUID,
  ADD COLUMN IF NOT EXISTS corrected_by UUID,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;

-- 2. Backfill shift_date for existing rows so the new index is meaningful
UPDATE public.staff_attendance
SET shift_date = (check_in AT TIME ZONE 'Asia/Kolkata')::date
WHERE shift_date IS NULL;

-- 3. Collapse duplicates inside the same block (keep earliest punch)
DELETE FROM public.staff_attendance sa
USING public.staff_attendance keep
WHERE sa.user_id = keep.user_id
  AND sa.shift_date = keep.shift_date
  AND sa.shift_type = keep.shift_type
  AND (keep.check_in < sa.check_in OR (keep.check_in = sa.check_in AND keep.id < sa.id));

-- 4. Block-based uniqueness replaces the open-row index
DROP INDEX IF EXISTS public.staff_attendance_one_open_per_shift_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS staff_attendance_block_uidx
  ON public.staff_attendance (user_id, shift_date, shift_type);

-- 5. Stop the stale-attendance job from inventing check-outs for staff
CREATE OR REPLACE FUNCTION public.auto_close_stale_staff_attendance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Check-in-only model: staff attendance has no check-out yet.
  RETURN 0;
END;
$$;

-- 6. Record a punch (idempotent per shift block)
CREATE OR REPLACE FUNCTION public.staff_record_punch(
  p_user_id UUID,
  p_branch_id UUID,
  p_check_in TIMESTAMPTZ DEFAULT now(),
  p_source TEXT DEFAULT 'manual',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'user and branch are required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('staff_attn:'||p_user_id::text));

  SELECT * INTO r FROM public.resolve_staff_shift(p_user_id, p_check_in, p_branch_id);

  SELECT sa.id INTO v_id
  FROM public.staff_attendance sa
  WHERE sa.user_id = p_user_id
    AND sa.shift_date = COALESCE(r.shift_date, (p_check_in AT TIME ZONE 'Asia/Kolkata')::date)
    AND sa.shift_type = COALESCE(r.shift_type, 'full_day'::public.attendance_shift_type)
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;  -- repeat scan inside the same block
  END IF;

  INSERT INTO public.staff_attendance (user_id, branch_id, check_in, notes, source, recorded_by)
  VALUES (p_user_id, p_branch_id, p_check_in, p_notes, COALESCE(p_source, 'manual'), auth.uid())
  ON CONFLICT (user_id, shift_date, shift_type) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT sa.id INTO v_id FROM public.staff_attendance sa
    WHERE sa.user_id = p_user_id
      AND sa.shift_date = COALESCE(r.shift_date, (p_check_in AT TIME ZONE 'Asia/Kolkata')::date)
      AND sa.shift_type = COALESCE(r.shift_type, 'full_day'::public.attendance_shift_type)
    LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_record_punch(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, service_role;

-- 7. Correct / delete a punch (managers and above)
CREATE OR REPLACE FUNCTION public.staff_correct_attendance(
  p_id UUID,
  p_check_in TIMESTAMPTZ DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to correct attendance';
  END IF;

  UPDATE public.staff_attendance
  SET check_in = COALESCE(p_check_in, check_in),
      notes = COALESCE(p_notes, notes),
      source = 'corrected',
      corrected_by = auth.uid(),
      corrected_at = now()
  WHERE id = p_id;

  RETURN p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_correct_attendance(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_delete_attendance(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to delete attendance';
  END IF;
  DELETE FROM public.staff_attendance WHERE id = p_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_delete_attendance(UUID) TO authenticated, service_role;

-- 8. Reconcile historical gate punches (28 Jul - 6 Aug 2026), earliest punch per block wins
DO $$
DECLARE
  rec RECORD;
  r RECORD;
BEGIN
  FOR rec IN
    SELECT al.profile_id, al.branch_id, al.captured_at
    FROM public.access_logs al
    WHERE al.profile_id IS NOT NULL
      AND al.result IN ('staff','trainer')
      AND al.captured_at >= '2026-07-27 18:30:00+00'
      AND al.captured_at <  '2026-08-07 18:30:00+00'
    ORDER BY al.captured_at ASC
  LOOP
    SELECT * INTO r FROM public.resolve_staff_shift(rec.profile_id, rec.captured_at, rec.branch_id);

    IF EXISTS (
      SELECT 1 FROM public.staff_attendance sa
      WHERE sa.user_id = rec.profile_id
        AND sa.shift_date = COALESCE(r.shift_date, (rec.captured_at AT TIME ZONE 'Asia/Kolkata')::date)
        AND sa.shift_type = COALESCE(r.shift_type, 'full_day'::public.attendance_shift_type)
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.staff_attendance (user_id, branch_id, check_in, source, notes)
      VALUES (rec.profile_id, rec.branch_id, rec.captured_at, 'gate', 'Reconciled from gate logs');
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;
END $$;

-- 9. Clear the fabricated check-outs left behind by the old toggle logic
UPDATE public.staff_attendance
SET check_out = NULL, total_hours = NULL
WHERE check_out IS NOT NULL
  AND check_in >= '2026-07-27 18:30:00+00';

-- 10. Mark historically bogus late alerts as read
UPDATE public.notifications
SET is_read = true
WHERE type = 'staff_late'
  AND is_read = false
  AND created_at < now();