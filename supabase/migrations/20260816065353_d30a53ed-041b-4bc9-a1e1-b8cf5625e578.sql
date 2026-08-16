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
  v_type text; v_start time; v_end time; v_ovn boolean;
  att RECORD; mk RECORD;
  v_rost numeric; v_act numeric;
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
    v_type  := b->>'t';
    v_start := NULLIF(b->>'s','')::time;
    v_end   := NULLIF(b->>'e','')::time;
    v_ovn   := (b->>'o')::boolean;
    v_seen  := v_seen || v_type;

    SELECT sa.* INTO att FROM public.staff_attendance sa
      WHERE sa.user_id = p_user_id AND sa.shift_date = p_date
        AND sa.shift_type::text = v_type LIMIT 1;

    SELECT m.* INTO mk FROM public.staff_block_marks m
      WHERE m.user_id = p_user_id AND m.shift_date = p_date
        AND m.shift_type::text = v_type LIMIT 1;

    v_rost := CASE
      WHEN v_start IS NULL OR v_end IS NULL THEN NULL
      WHEN v_ovn THEN EXTRACT(EPOCH FROM ((v_end + interval '24 hours') - v_start))/3600.0
      ELSE EXTRACT(EPOCH FROM (v_end - v_start))/3600.0
    END;

    v_act := NULL;
    IF att.check_in IS NOT NULL AND att.check_out IS NOT NULL AND att.check_out > att.check_in
       AND COALESCE(att.source,'') <> 'auto_close' THEN
      v_act := EXTRACT(EPOCH FROM (att.check_out - att.check_in))/3600.0;
      IF v_rost IS NOT NULL AND v_act > v_rost + 4 THEN v_act := NULL; END IF;
      IF v_act IS NOT NULL AND v_act > 16 THEN v_act := NULL; END IF;
    END IF;

    v_end_ts := (p_date + COALESCE(v_end, '23:59'::time))
                + CASE WHEN v_ovn THEN interval '24 hours' ELSE interval '0' END;

    shift_type := v_type; scheduled_start := v_start; scheduled_end := v_end;
    is_overnight := v_ovn; rostered := true;
    attendance_id := att.id; check_in := att.check_in; check_out := att.check_out;
    is_late := COALESCE(att.is_late, false); late_minutes := att.late_minutes;
    source := att.source; notes := att.notes;
    mark_state := mk.state; mark_reason := mk.reason;
    rostered_hours := round(COALESCE(v_rost, 0)::numeric, 2);
    actual_hours := CASE WHEN v_act IS NULL THEN NULL ELSE round(v_act::numeric, 2) END;
    IF att.check_in IS NULL THEN
      hours := 0; hours_source := 'none';
    ELSIF v_act IS NOT NULL THEN
      hours := round(v_act::numeric, 2); hours_source := 'actual';
    ELSE
      hours := round(COALESCE(v_rost, 0)::numeric, 2); hours_source := 'rostered';
    END IF;
    state := CASE
      WHEN att.id IS NOT NULL THEN 'attended'
      WHEN mk.state = 'leave' THEN 'leave'
      WHEN mk.state = 'absent' THEN 'absent'
      WHEN v_now > v_end_ts THEN 'missed'
      ELSE 'pending'
    END;
    RETURN NEXT;
  END LOOP;

  FOR att IN
    SELECT sa.* FROM public.staff_attendance sa
     WHERE sa.user_id = p_user_id AND sa.shift_date = p_date
       AND NOT (sa.shift_type::text = ANY(v_seen))
  LOOP
    v_act := NULL;
    IF att.check_out IS NOT NULL AND att.check_out > att.check_in
       AND COALESCE(att.source,'') <> 'auto_close' THEN
      v_act := EXTRACT(EPOCH FROM (att.check_out - att.check_in))/3600.0;
      IF v_act > 16 THEN v_act := NULL; END IF;
    END IF;
    shift_type := att.shift_type::text; scheduled_start := att.scheduled_start;
    scheduled_end := NULL; is_overnight := false; rostered := false;
    attendance_id := att.id; check_in := att.check_in; check_out := att.check_out;
    is_late := COALESCE(att.is_late, false); late_minutes := att.late_minutes;
    source := att.source; notes := att.notes;
    mark_state := NULL; mark_reason := NULL;
    rostered_hours := 0;
    actual_hours := CASE WHEN v_act IS NULL THEN NULL ELSE round(v_act::numeric,2) END;
    hours := COALESCE(actual_hours, 0);
    hours_source := CASE WHEN v_act IS NULL THEN 'none' ELSE 'actual' END;
    state := 'attended';
    RETURN NEXT;
  END LOOP;
END;
$function$;