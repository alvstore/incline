-- ---------------------------------------------------------------------------
-- 1. Authorisation helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_primary_branch(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT e.branch_id FROM public.employees e WHERE e.user_id = p_user_id AND e.branch_id IS NOT NULL LIMIT 1),
    (SELECT t.branch_id FROM public.trainers t WHERE t.user_id = p_user_id AND t.branch_id IS NOT NULL LIMIT 1),
    (SELECT sb.branch_id FROM public.staff_branches sb WHERE sb.user_id = p_user_id LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_can_manage_staff_attendance(p_target_user uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF p_target_user IS NULL THEN
    RAISE EXCEPTION 'Target staff member is required';
  END IF;
  IF p_target_user = auth.uid() THEN
    RAISE EXCEPTION 'You cannot modify your own attendance';
  END IF;

  v_branch := public.staff_primary_branch(p_target_user);

  IF public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') THEN
    RETURN v_branch;
  END IF;

  IF public.has_role(auth.uid(),'manager') THEN
    IF v_branch IS NOT NULL
       AND v_branch IN (SELECT public.user_visible_branch_ids(auth.uid())) THEN
      RETURN v_branch;
    END IF;
    RAISE EXCEPTION 'Not authorised for this branch';
  END IF;

  RAISE EXCEPTION 'Not authorised to modify staff attendance';
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_primary_branch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_can_manage_staff_attendance(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Manual attendance for a day with no record
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_mark_manual_attendance(
  p_user_id uuid,
  p_shift_date date,
  p_shift_type public.attendance_shift_type DEFAULT NULL,
  p_check_in timestamptz DEFAULT NULL,
  p_check_out timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_branch uuid;
  blk RECORD;
  v_type public.attendance_shift_type;
  v_in timestamptz;
  v_out timestamptz;
  v_id uuid;
BEGIN
  IF COALESCE(p_reason,'') = '' THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  -- server-side branch: never trust the client value
  v_branch := public.assert_can_manage_staff_attendance(p_user_id);
  v_branch := COALESCE(v_branch, p_branch_id);
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Could not resolve a branch for this staff member';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('staff_attn:'||p_user_id::text));

  -- resolve the rostered block for that date (override > weekly roster)
  SELECT * INTO blk
  FROM public.staff_day_blocks(p_user_id, p_shift_date) b
  WHERE p_shift_type IS NULL OR b.shift_type = p_shift_type::text
  ORDER BY b.scheduled_start NULLS LAST
  LIMIT 1;

  v_type := COALESCE(p_shift_type, NULLIF(blk.shift_type,'')::public.attendance_shift_type, 'full_day');

  -- default check-in = scheduled start; overnight end rolls to the next day
  v_in := COALESCE(
    p_check_in,
    CASE WHEN blk.scheduled_start IS NOT NULL
      THEN ((p_shift_date + blk.scheduled_start) AT TIME ZONE 'Asia/Kolkata')
    END,
    ((p_shift_date + TIME '09:00') AT TIME ZONE 'Asia/Kolkata')
  );

  v_out := COALESCE(
    p_check_out,
    CASE WHEN blk.scheduled_end IS NOT NULL
      THEN ((p_shift_date + blk.scheduled_end
             + CASE WHEN COALESCE(blk.is_overnight,false) THEN interval '24 hours' ELSE interval '0' END
            ) AT TIME ZONE 'Asia/Kolkata')
    END
  );

  IF v_out IS NOT NULL AND v_out <= v_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_attendance sa
    WHERE sa.user_id = p_user_id AND sa.shift_date = p_shift_date AND sa.shift_type = v_type
  ) THEN
    RAISE EXCEPTION 'Attendance already exists for this staff member on % (% shift)', p_shift_date, v_type;
  END IF;

  INSERT INTO public.staff_attendance
    (user_id, branch_id, check_in, check_out, shift_type, shift_date, notes, source, recorded_by, corrected_by, corrected_at)
  VALUES
    (p_user_id, v_branch, v_in, v_out, v_type, p_shift_date, p_reason, 'manual', auth.uid(), auth.uid(), now())
  RETURNING id INTO v_id;

  -- a manual present supersedes any absent/leave mark on that block
  DELETE FROM public.staff_block_marks
   WHERE user_id = p_user_id AND shift_date = p_shift_date AND shift_type = v_type;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_mark_manual_attendance(uuid, date, public.attendance_shift_type, timestamptz, timestamptz, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Canonical correction RPC (check-in + check-out + notes + shift date)
--    Previous version could only change check_in/notes, leaving hours stale.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.staff_correct_attendance(uuid, timestamptz, text);

CREATE OR REPLACE FUNCTION public.staff_correct_attendance(
  p_id uuid,
  p_check_in timestamptz DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_check_out timestamptz DEFAULT NULL,
  p_shift_date date DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_clear_check_out boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.staff_attendance%ROWTYPE;
  v_in timestamptz;
  v_out timestamptz;
BEGIN
  SELECT * INTO v_row FROM public.staff_attendance WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attendance record not found'; END IF;

  PERFORM public.assert_can_manage_staff_attendance(v_row.user_id);

  v_in  := COALESCE(p_check_in, v_row.check_in);
  v_out := CASE WHEN p_clear_check_out THEN NULL ELSE COALESCE(p_check_out, v_row.check_out) END;

  IF v_out IS NOT NULL AND v_out <= v_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;

  -- Setting check_in re-fires tg_stamp_staff_attendance_shift, which recomputes
  -- shift_type / shift_date / scheduled_start / scheduled_start_at /
  -- scheduled_end_at / late_minutes / is_late. total_hours is recomputed by
  -- tg_fill_attendance_total_hours. Nothing is calculated in the client.
  UPDATE public.staff_attendance
     SET check_in  = v_in,
         check_out = v_out,
         notes     = COALESCE(NULLIF(p_reason,''), p_notes, notes),
         source    = 'corrected',
         corrected_by = auth.uid(),
         corrected_at = now()
   WHERE id = p_id;

  -- explicit shift-date move (rare; e.g. a punch filed on the wrong day)
  IF p_shift_date IS NOT NULL AND p_shift_date <> v_row.shift_date THEN
    UPDATE public.staff_attendance SET shift_date = p_shift_date WHERE id = p_id;
  END IF;

  RETURN p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_correct_attendance(uuid, timestamptz, text, timestamptz, date, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Delete now requires a reason + branch check
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.staff_delete_attendance(uuid);

CREATE OR REPLACE FUNCTION public.staff_delete_attendance(p_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.staff_attendance%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.staff_attendance WHERE id = p_id;
  IF NOT FOUND THEN RETURN true; END IF;

  PERFORM public.assert_can_manage_staff_attendance(v_row.user_id);

  IF COALESCE(p_reason,'') = '' THEN
    RAISE EXCEPTION 'Reason is required to remove an attendance record';
  END IF;

  -- stamp the reason so the audit trigger captures it in before_data
  UPDATE public.staff_attendance
     SET notes = COALESCE(notes || ' | ', '') || ('removed: ' || p_reason),
         corrected_by = auth.uid(), corrected_at = now()
   WHERE id = p_id;

  DELETE FROM public.staff_attendance WHERE id = p_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_delete_attendance(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Block marks: branch derived server-side, states validated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_mark_block(
  p_user_id uuid,
  p_date date,
  p_shift_type text,
  p_state text,
  p_reason text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_branch uuid;
BEGIN
  IF p_state NOT IN ('absent','leave','clear') THEN
    RAISE EXCEPTION 'Invalid state % (allowed: absent, leave, clear). Weekly off is a roster setting, not an attendance mark.', p_state;
  END IF;

  v_branch := public.assert_can_manage_staff_attendance(p_user_id);
  v_branch := COALESCE(v_branch, p_branch_id);

  IF p_state = 'clear' THEN
    DELETE FROM public.staff_block_marks
     WHERE user_id = p_user_id AND shift_date = p_date AND shift_type::text = p_shift_type;
    RETURN NULL;
  END IF;

  IF COALESCE(p_reason,'') = '' THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  INSERT INTO public.staff_block_marks (user_id, branch_id, shift_date, shift_type, state, reason, marked_by)
  VALUES (p_user_id, v_branch, p_date, p_shift_type::public.attendance_shift_type, p_state, p_reason, auth.uid())
  ON CONFLICT (user_id, shift_date, shift_type)
  DO UPDATE SET state = EXCLUDED.state, reason = EXCLUDED.reason,
                marked_by = auth.uid(), created_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Payroll staleness flag (never touches amounts)
-- ---------------------------------------------------------------------------
ALTER TABLE public.payroll_items
  ADD COLUMN IF NOT EXISTS attendance_changed_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_flag_payroll_attendance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_date date := COALESCE(NEW.shift_date, OLD.shift_date);
BEGIN
  IF v_user IS NULL OR v_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.payroll_items pi
     SET attendance_changed_at = now()
    FROM public.payroll_runs pr
   WHERE pr.id = pi.run_id
     AND pi.user_id = v_user
     AND v_date BETWEEN pr.period_start AND pr.period_end
     AND pr.status NOT IN ('processed','paid');

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_payroll_attendance_change ON public.staff_attendance;
CREATE TRIGGER trg_flag_payroll_attendance_change
AFTER INSERT OR UPDATE OR DELETE ON public.staff_attendance
FOR EACH ROW EXECUTE FUNCTION public.tg_flag_payroll_attendance_change();

DROP TRIGGER IF EXISTS trg_flag_payroll_block_mark_change ON public.staff_block_marks;
CREATE TRIGGER trg_flag_payroll_block_mark_change
AFTER INSERT OR UPDATE OR DELETE ON public.staff_block_marks
FOR EACH ROW EXECUTE FUNCTION public.tg_flag_payroll_attendance_change();

-- ---------------------------------------------------------------------------
-- 7. Reopen an approved payroll run (owner/admin, audited)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payroll_reopen_run(p_run_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run public.payroll_runs%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners and admins can reopen a payroll run';
  END IF;
  IF COALESCE(p_reason,'') = '' THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT * INTO v_run FROM public.payroll_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payroll run not found'; END IF;

  IF v_run.status IN ('processed','paid') THEN
    RAISE EXCEPTION 'Payroll already % — create a payroll adjustment instead', v_run.status;
  END IF;

  v_before := to_jsonb(v_run);

  UPDATE public.payroll_runs
     SET status = 'draft', approved_by = NULL, approved_at = NULL,
         reviewed_by = NULL, reviewed_at = NULL
   WHERE id = p_run_id;

  SELECT to_jsonb(pr) INTO v_after FROM public.payroll_runs pr WHERE id = p_run_id;

  INSERT INTO public.payroll_audit (run_id, item_id, actor_id, action, before_data, after_data, reason)
  VALUES (p_run_id, NULL, auth.uid(), 'reopen_run', v_before, v_after, p_reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.payroll_reopen_run(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Security finding: branch-scope scan report deliveries
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can view scan deliveries" ON public.scan_report_deliveries;
CREATE POLICY "Staff can view scan deliveries"
ON public.scan_report_deliveries
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(),'owner')
  OR public.has_role(auth.uid(),'admin')
  OR (
    (public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'staff'))
    AND branch_id IS NOT NULL
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);