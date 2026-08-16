-- 1. Manager block marks (absent / leave for a specific roster block)
CREATE TABLE IF NOT EXISTS public.staff_block_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  branch_id uuid,
  shift_date date NOT NULL,
  shift_type public.attendance_shift_type NOT NULL,
  state text NOT NULL CHECK (state IN ('absent','leave')),
  reason text,
  marked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, shift_date, shift_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_block_marks TO authenticated;
GRANT ALL ON public.staff_block_marks TO service_role;

ALTER TABLE public.staff_block_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management can manage block marks"
  ON public.staff_block_marks FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]));

CREATE POLICY "Staff can view their own block marks"
  ON public.staff_block_marks FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_shift_date
  ON public.staff_attendance (user_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_staff_block_marks_user_date
  ON public.staff_block_marks (user_id, shift_date);

-- 2. Payroll line columns
ALTER TABLE public.payroll_run_lines
  ADD COLUMN IF NOT EXISTS payable_fraction numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS blocks_rostered int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocks_attended int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hours_source text;

-- 3. staff_day_blocks: every rostered block for a user on a date + attendance state
CREATE OR REPLACE FUNCTION public.staff_day_blocks(p_user_id uuid, p_date date)
RETURNS TABLE(
  shift_type text,
  scheduled_start time,
  scheduled_end time,
  is_overnight boolean,
  rostered boolean,
  attendance_id uuid,
  check_in timestamptz,
  check_out timestamptz,
  is_late boolean,
  late_minutes int,
  source text,
  notes text,
  mark_state text,
  mark_reason text,
  state text,
  rostered_hours numeric,
  actual_hours numeric,
  hours numeric,
  hours_source text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_now timestamp := (now() AT TIME ZONE 'Asia/Kolkata');
  v_blocks jsonb := '[]'::jsonb;
  b jsonb;
  v_type text;
  v_start time;
  v_end time;
  v_ovn boolean;
  att RECORD;
  mk RECORD;
  v_rost numeric;
  v_act numeric;
  v_end_ts timestamp;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  SELECT * INTO r FROM public._staff_roster_for_date(p_user_id, p_date);

  IF r.has_schedule AND NOT COALESCE(r.is_off, false) THEN
    IF r.m_start IS NOT NULL THEN
      v_start := r.m_start; v_end := r.m_end;
      v_ovn := (v_end IS NOT NULL AND v_end < v_start);
      IF v_ovn THEN
        v_type := 'night';
      ELSIF r.e_start IS NULL AND v_end IS NOT NULL AND (v_end - v_start) >= interval '10 hours' THEN
        v_type := 'full_day';
      ELSE
        v_type := 'morning';
      END IF;
      v_blocks := v_blocks || jsonb_build_object('t', v_type, 's', v_start, 'e', v_end, 'o', v_ovn);
    END IF;

    IF r.e_start IS NOT NULL THEN
      v_start := r.e_start; v_end := r.e_end;
      v_ovn := (v_end IS NOT NULL AND v_end < v_start);
      v_type := CASE WHEN v_ovn THEN 'night' ELSE 'evening' END;
      v_blocks := v_blocks || jsonb_build_object('t', v_type, 's', v_start, 'e', v_end, 'o', v_ovn);
    END IF;
  END IF;

  FOR b IN SELECT * FROM jsonb_array_elements(v_blocks) LOOP
    shift_type      := b->>'t';
    scheduled_start := NULLIF(b->>'s','')::time;
    scheduled_end   := NULLIF(b->>'e','')::time;
    is_overnight    := (b->>'o')::boolean;
    rostered        := true;
    v_seen          := v_seen || shift_type;

    SELECT sa.* INTO att FROM public.staff_attendance sa
      WHERE sa.user_id = p_user_id AND sa.shift_date = p_date
        AND sa.shift_type::text = shift_type LIMIT 1;

    SELECT m.* INTO mk FROM public.staff_block_marks m
      WHERE m.user_id = p_user_id AND m.shift_date = p_date
        AND m.shift_type::text = shift_type LIMIT 1;

    attendance_id := att.id; check_in := att.check_in; check_out := att.check_out;
    is_late := COALESCE(att.is_late, false); late_minutes := att.late_minutes;
    source := att.source; notes := att.notes;
    mark_state := mk.state; mark_reason := mk.reason;

    v_rost := CASE
      WHEN scheduled_start IS NULL OR scheduled_end IS NULL THEN NULL
      WHEN is_overnight THEN EXTRACT(EPOCH FROM ((scheduled_end + interval '24 hours') - scheduled_start))/3600.0
      ELSE EXTRACT(EPOCH FROM (scheduled_end - scheduled_start))/3600.0
    END;
    rostered_hours := round(COALESCE(v_rost, 0)::numeric, 2);

    v_act := NULL;
    IF att.check_in IS NOT NULL AND att.check_out IS NOT NULL AND att.check_out > att.check_in
       AND COALESCE(att.source,'') <> 'auto_close' THEN
      v_act := EXTRACT(EPOCH FROM (att.check_out - att.check_in))/3600.0;
      -- reject implausible spans (synthetic / gate-exit noise)
      IF v_rost IS NOT NULL AND v_act > v_rost + 4 THEN v_act := NULL; END IF;
      IF v_act IS NOT NULL AND v_act > 16 THEN v_act := NULL; END IF;
    END IF;
    actual_hours := CASE WHEN v_act IS NULL THEN NULL ELSE round(v_act::numeric, 2) END;

    IF att.check_in IS NULL THEN
      hours := 0; hours_source := 'none';
    ELSIF v_act IS NOT NULL THEN
      hours := round(v_act::numeric, 2); hours_source := 'actual';
    ELSE
      hours := round(COALESCE(v_rost, 0)::numeric, 2); hours_source := 'rostered';
    END IF;

    v_end_ts := (p_date + COALESCE(scheduled_end, '23:59'::time))
                + CASE WHEN is_overnight THEN interval '24 hours' ELSE interval '0' END;

    state := CASE
      WHEN att.id IS NOT NULL THEN 'attended'
      WHEN mk.state = 'leave' THEN 'leave'
      WHEN mk.state = 'absent' THEN 'absent'
      WHEN v_now > v_end_ts THEN 'missed'
      ELSE 'pending'
    END;

    RETURN NEXT;
  END LOOP;

  -- attendance rows outside the roster (unscheduled punches)
  FOR att IN
    SELECT sa.* FROM public.staff_attendance sa
     WHERE sa.user_id = p_user_id AND sa.shift_date = p_date
       AND NOT (sa.shift_type::text = ANY(v_seen))
  LOOP
    shift_type := att.shift_type::text;
    scheduled_start := att.scheduled_start;
    scheduled_end := NULL; is_overnight := false; rostered := false;
    attendance_id := att.id; check_in := att.check_in; check_out := att.check_out;
    is_late := COALESCE(att.is_late, false); late_minutes := att.late_minutes;
    source := att.source; notes := att.notes;
    mark_state := NULL; mark_reason := NULL;
    rostered_hours := 0;
    v_act := NULL;
    IF att.check_out IS NOT NULL AND att.check_out > att.check_in
       AND COALESCE(att.source,'') <> 'auto_close' THEN
      v_act := EXTRACT(EPOCH FROM (att.check_out - att.check_in))/3600.0;
      IF v_act > 16 THEN v_act := NULL; END IF;
    END IF;
    actual_hours := CASE WHEN v_act IS NULL THEN NULL ELSE round(v_act::numeric,2) END;
    hours := COALESCE(actual_hours, 0);
    hours_source := CASE WHEN v_act IS NULL THEN 'none' ELSE 'actual' END;
    state := 'attended';
    RETURN NEXT;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.staff_day_blocks(uuid, date) TO authenticated, service_role;

-- 4. Manager override for a single block
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
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to mark attendance blocks';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot mark your own attendance';
  END IF;
  IF p_state NOT IN ('absent','leave','clear') THEN
    RAISE EXCEPTION 'Invalid state %', p_state;
  END IF;

  IF p_state = 'clear' THEN
    DELETE FROM public.staff_block_marks
     WHERE user_id = p_user_id AND shift_date = p_date
       AND shift_type::text = p_shift_type;
    RETURN NULL;
  END IF;

  INSERT INTO public.staff_block_marks (user_id, branch_id, shift_date, shift_type, state, reason, marked_by)
  VALUES (p_user_id, p_branch_id, p_date, p_shift_type::public.attendance_shift_type, p_state, p_reason, auth.uid())
  ON CONFLICT (user_id, shift_date, shift_type)
  DO UPDATE SET state = EXCLUDED.state, reason = EXCLUDED.reason,
                marked_by = auth.uid(), created_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.staff_mark_block(uuid, date, text, text, text, uuid) TO authenticated, service_role;

-- 5. Block-aware payroll
DROP FUNCTION IF EXISTS public.compute_payroll(uuid, date, date, uuid);

CREATE OR REPLACE FUNCTION public.compute_payroll(
  p_user_id uuid, p_period_start date, p_period_end date, p_run_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  work_date date, status text, hours_worked numeric, ot_hours numeric,
  is_late boolean, is_early_out boolean, is_missing_checkout boolean, is_half_day boolean,
  is_holiday boolean, is_weekly_off boolean, leave_type text, payable boolean, notes text,
  payable_fraction numeric, blocks_rostered int, blocks_attended int, hours_source text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_d date;
  v_rec RECORD;
  v_blk RECORD;
  v_grace int; v_ot_th numeric;
  v_branch uuid;
  v_rostered int; v_attended int; v_leave_blocks int;
  v_hours numeric; v_ot numeric;
  v_late boolean; v_missing boolean; v_holiday boolean; v_weekly_off boolean;
  v_leave text; v_payable boolean; v_frac numeric; v_status text; v_notes text;
  v_hsrc text; v_any_rostered_src boolean; v_missed_list text;
  v_holiday_mult numeric;
BEGIN
  SELECT ss.branch_id INTO v_branch FROM public.staff_shifts ss
   WHERE ss.user_id = p_user_id AND ss.branch_id IS NOT NULL LIMIT 1;

  v_d := p_period_start;
  WHILE v_d <= p_period_end LOOP
    v_rostered := 0; v_attended := 0; v_leave_blocks := 0;
    v_hours := 0; v_ot := 0; v_late := false; v_missing := false;
    v_holiday := false; v_weekly_off := false; v_leave := NULL;
    v_notes := NULL; v_hsrc := NULL; v_any_rostered_src := false;
    v_missed_list := NULL; v_holiday_mult := 1.0;

    SELECT * INTO v_rec FROM public.staff_shifts ss
      WHERE ss.user_id = p_user_id AND ss.weekday = EXTRACT(DOW FROM v_d)::int LIMIT 1;
    v_grace := COALESCE(v_rec.late_grace_min, 15);
    v_ot_th := COALESCE(v_rec.ot_threshold_hours, 8.5);

    SELECT true, COALESCE(h.pay_multiplier,1.0) INTO v_holiday, v_holiday_mult
      FROM public.holidays h WHERE h.holiday_date = v_d
        AND (h.branch_id IS NULL OR h.branch_id = v_branch) LIMIT 1;
    v_holiday := COALESCE(v_holiday, false);

    SELECT lr.leave_type INTO v_leave FROM public.leave_requests lr
      WHERE lr.user_id = p_user_id AND lr.status = 'approved'
        AND v_d BETWEEN lr.start_date AND lr.end_date LIMIT 1;

    FOR v_blk IN SELECT * FROM public.staff_day_blocks(p_user_id, v_d) LOOP
      IF v_blk.rostered THEN v_rostered := v_rostered + 1; END IF;
      IF v_blk.state = 'attended' THEN
        v_attended := v_attended + 1;
        v_hours := v_hours + COALESCE(v_blk.hours, 0);
        IF v_blk.is_late THEN v_late := true; END IF;
        IF v_blk.hours_source = 'rostered' THEN v_any_rostered_src := true; END IF;
        IF v_blk.hours_source = 'none' THEN v_missing := true; END IF;
      ELSIF v_blk.state = 'leave' THEN
        v_leave_blocks := v_leave_blocks + 1;
      ELSIF v_blk.state IN ('missed','absent') THEN
        v_missed_list := COALESCE(v_missed_list || ', ', '') || v_blk.shift_type || ' missed';
      END IF;
    END LOOP;

    v_hours := round(LEAST(v_hours, 24), 2);
    v_weekly_off := (v_rostered = 0 AND v_attended = 0);

    -- payable fraction: attended blocks over rostered blocks (leave blocks are excluded
    -- from the denominator and paid separately by leave policy)
    IF v_rostered - v_leave_blocks > 0 THEN
      v_frac := round(LEAST(v_attended::numeric / (v_rostered - v_leave_blocks)::numeric, 1), 2);
    ELSIF v_attended > 0 THEN
      v_frac := 1;
    ELSE
      v_frac := 0;
    END IF;

    IF v_attended > 0 THEN
      IF v_frac >= 1 THEN
        v_status := 'present'; v_payable := true;
      ELSE
        v_status := 'half_day'; v_payable := true;
        v_frac := GREATEST(v_frac, 0.5);
        v_frac := 0.5;
      END IF;
      IF v_hours > v_ot_th THEN v_ot := round(v_hours - v_ot_th, 2); END IF;
      v_notes := v_missed_list;
      IF v_any_rostered_src THEN
        v_notes := COALESCE(v_notes || '; ', '') || 'hours_from_roster';
      END IF;
      IF v_holiday AND v_holiday_mult > 1 THEN
        v_notes := COALESCE(v_notes || '; ', '') || format('holiday_pay_x%s', v_holiday_mult);
      END IF;
      v_hsrc := CASE WHEN v_any_rostered_src THEN 'rostered' ELSE 'actual' END;
    ELSIF v_holiday THEN
      v_status := 'holiday'; v_payable := true; v_frac := 1; v_notes := 'paid_holiday';
    ELSIF v_leave IS NOT NULL OR v_leave_blocks > 0 THEN
      v_status := 'leave';
      v_leave := COALESCE(v_leave, 'marked_leave');
      v_payable := (v_leave IN ('paid','sick','earned','comp_off'));
      v_frac := CASE WHEN v_payable THEN 1 ELSE 0 END;
      v_notes := v_leave;
    ELSIF v_weekly_off THEN
      v_status := 'weekly_off'; v_payable := true; v_frac := 1;
    ELSIF v_d > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
      v_status := 'scheduled'; v_payable := false; v_frac := 0; v_notes := 'future_date';
    ELSE
      v_status := 'absent'; v_payable := false; v_frac := 0; v_notes := v_missed_list;
    END IF;

    work_date := v_d; status := v_status; hours_worked := v_hours; ot_hours := v_ot;
    is_late := v_late; is_early_out := false; is_missing_checkout := v_missing;
    is_half_day := (v_status = 'half_day'); is_holiday := v_holiday;
    is_weekly_off := v_weekly_off; leave_type := v_leave; payable := v_payable;
    notes := v_notes; payable_fraction := v_frac;
    blocks_rostered := v_rostered; blocks_attended := v_attended;
    hours_source := v_hsrc;
    RETURN NEXT;

    IF p_run_id IS NOT NULL THEN
      INSERT INTO public.payroll_run_lines (
        run_id, user_id, work_date, status, hours_worked, ot_hours,
        is_late, is_early_out, is_missing_checkout, is_half_day,
        is_holiday, is_weekly_off, leave_type, payable, notes,
        payable_fraction, blocks_rostered, blocks_attended, hours_source
      ) VALUES (
        p_run_id, p_user_id, v_d, v_status, v_hours, v_ot,
        v_late, false, v_missing, (v_status = 'half_day'),
        v_holiday, v_weekly_off, v_leave, v_payable, v_notes,
        v_frac, v_rostered, v_attended, v_hsrc
      );
    END IF;

    v_d := v_d + 1;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.compute_payroll(uuid, date, date, uuid) TO authenticated, service_role;