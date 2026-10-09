ALTER TABLE public.pt_auto_attendance_log ADD COLUMN IF NOT EXISTS match_reason text;
ALTER TABLE public.pt_auto_attendance_log DROP CONSTRAINT IF EXISTS pt_auto_attendance_outcome_chk;
ALTER TABLE public.pt_auto_attendance_log ADD CONSTRAINT pt_auto_attendance_outcome_chk CHECK (outcome IN ('awaiting_trainer','auto_logged','ready_to_confirm','needs_review','trainer_no_show','confirmed','dismissed','reversed'));
ALTER TABLE public.pt_auto_attendance_log ADD CONSTRAINT pt_auto_attendance_reason_chk CHECK (match_reason IS NULL OR match_reason IN ('co_arrival','on_duty','outside_duty','trainer_very_late'));

-- Trainers can read their own clients' rows
CREATE POLICY "Trainers read own PT auto attendance" ON public.pt_auto_attendance_log
  FOR SELECT TO authenticated
  USING (trainer_id IN (SELECT t.id FROM public.trainers t WHERE t.user_id = (SELECT auth.uid())));

CREATE TABLE public.pt_attendance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_id uuid NOT NULL REFERENCES public.pt_auto_attendance_log(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  trainer_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('mark','undo')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approval_request_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pt_attendance_corrections TO authenticated;
GRANT ALL ON public.pt_attendance_corrections TO service_role;
ALTER TABLE public.pt_attendance_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read PT attendance corrections" ON public.pt_attendance_corrections
  FOR SELECT TO authenticated
  USING (
    requested_by = (SELECT auth.uid())
    OR trainer_id IN (SELECT t.id FROM public.trainers t WHERE t.user_id = (SELECT auth.uid()))
    OR (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]))
    OR branch_id IN (SELECT public.managed_branch_ids(auth.uid()))
  );
CREATE UNIQUE INDEX pt_attendance_corrections_one_pending ON public.pt_attendance_corrections (log_id) WHERE status = 'pending';
CREATE INDEX pt_attendance_corrections_branch_status ON public.pt_attendance_corrections (branch_id, status);

-- Config gains mode
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_config(p_branch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('enabled', true, 'mode', 'auto', 'window_minutes', 30, 'late_alert_minutes', 10, 'notify_manager', true)
      || COALESCE((SELECT value FROM public.settings WHERE branch_id IS NULL AND key = 'pt_auto_attendance' AND jsonb_typeof(value) = 'object'), '{}'::jsonb)
      || COALESCE((SELECT value FROM public.settings WHERE branch_id = p_branch_id AND key = 'pt_auto_attendance' AND jsonb_typeof(value) = 'object'), '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.pt_auto_attendance_set_config(p_branch_id uuid, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clean jsonb; v_mode text;
BEGIN
  IF public.rpc_guard_applies('pt_auto_attendance_set_config') THEN
    IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]) THEN
      IF p_branch_id IS NULL OR p_branch_id NOT IN (SELECT public.managed_branch_ids(auth.uid())) THEN RAISE EXCEPTION 'not_authorized'; END IF;
    END IF;
  END IF;
  v_mode := COALESCE(p_config->>'mode', 'auto');
  IF v_mode NOT IN ('auto','review','manual') THEN v_mode := 'auto'; END IF;
  v_clean := jsonb_build_object(
    'enabled', v_mode <> 'manual',
    'mode', v_mode,
    'window_minutes', GREATEST(5, LEAST(180, COALESCE((p_config->>'window_minutes')::int, 30))),
    'late_alert_minutes', GREATEST(0, LEAST(120, COALESCE((p_config->>'late_alert_minutes')::int, 10))),
    'notify_manager', COALESCE((p_config->>'notify_manager')::boolean, true));
  UPDATE public.settings SET value = v_clean, updated_at = now() WHERE key = 'pt_auto_attendance' AND branch_id IS NOT DISTINCT FROM p_branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.settings (branch_id, key, value, description) VALUES (p_branch_id, 'pt_auto_attendance', v_clean, 'Automatic PT attendance from gate scans');
  END IF;
  RETURN v_clean;
END; $$;

-- Evaluator v2: roster-aware duty window + modes
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_evaluate(p_package_id uuid, p_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pkg public.member_pt_packages%ROWTYPE;
  v_cfg jsonb; v_mode text; v_window interval; v_late int;
  v_trainer_user uuid; v_trainer_name text; v_member_name text;
  v_log public.pt_auto_attendance_log%ROWTYPE;
  v_m timestamptz; v_m0 timestamptz; v_t1 timestamptz; v_tany timestamptz;
  v_pair_m timestamptz; v_pair_t timestamptz; v_reason text;
  v_gap int; v_session uuid; v_outcome text;
  s record; v_last_scan timestamptz; v_end timestamptz;
  v_day_start timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Kolkata';
  v_day_end timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Kolkata';
BEGIN
  SELECT * INTO v_pkg FROM public.member_pt_packages WHERE id = p_package_id;
  IF NOT FOUND OR v_pkg.status <> 'active' OR v_pkg.trainer_id IS NULL THEN RETURN 'skip_package'; END IF;
  IF v_pkg.start_date IS NOT NULL AND p_date < v_pkg.start_date THEN RETURN 'skip_not_started'; END IF;
  IF v_pkg.package_type = 'monthly' AND v_pkg.expiry_date IS NOT NULL AND p_date > v_pkg.expiry_date THEN RETURN 'skip_expired'; END IF;
  IF v_pkg.package_type = 'session_based' AND COALESCE(v_pkg.sessions_remaining,0) <= 0 THEN RETURN 'skip_no_sessions'; END IF;

  v_cfg := public.pt_auto_attendance_config(v_pkg.branch_id);
  v_mode := COALESCE(v_cfg->>'mode', 'auto');
  IF v_mode = 'manual' OR NOT COALESCE((v_cfg->>'enabled')::boolean, true) THEN RETURN 'manual_mode'; END IF;
  v_window := make_interval(mins => GREATEST(5, LEAST(180, COALESCE((v_cfg->>'window_minutes')::int, 30))));
  v_late := COALESCE((v_cfg->>'late_alert_minutes')::int, 10);

  SELECT * INTO v_log FROM public.pt_auto_attendance_log WHERE member_pt_package_id = p_package_id AND session_date = p_date;
  IF FOUND AND (v_log.outcome IN ('auto_logged','ready_to_confirm','confirmed','dismissed','reversed')
                OR (v_log.outcome = 'needs_review' AND v_log.match_reason = 'trainer_very_late')) THEN
    RETURN 'already_' || v_log.outcome;
  END IF;

  IF EXISTS (SELECT 1 FROM public.pt_sessions ps WHERE ps.member_pt_package_id = p_package_id
               AND timezone('Asia/Kolkata', ps.scheduled_at)::date = p_date
               AND ps.status NOT IN ('scheduled','cancelled','rescheduled')) THEN
    RETURN 'already_manual';
  END IF;

  SELECT t.user_id INTO v_trainer_user FROM public.trainers t WHERE t.id = v_pkg.trainer_id;

  CREATE TEMP TABLE IF NOT EXISTS _pt_m (at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _pt_t (at timestamptz) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _pt_ti (s timestamptz, e timestamptz) ON COMMIT DROP;
  TRUNCATE _pt_m; TRUNCATE _pt_t; TRUNCATE _pt_ti;

  INSERT INTO _pt_m
    SELECT COALESCE(al.captured_at, al.created_at) FROM public.access_logs al
     WHERE al.member_id = v_pkg.member_id AND al.result IN ('member','accepted')
       AND COALESCE(al.captured_at, al.created_at) >= v_day_start AND COALESCE(al.captured_at, al.created_at) < v_day_end
    UNION
    SELECT ma.check_in FROM public.member_attendance ma
     WHERE ma.member_id = v_pkg.member_id AND ma.check_in >= v_day_start AND ma.check_in < v_day_end
       AND COALESCE(ma.check_in_method,'') <> 'pt_session';

  IF v_trainer_user IS NOT NULL THEN
    INSERT INTO _pt_t
      SELECT COALESCE(al.captured_at, al.created_at) FROM public.access_logs al
       WHERE al.profile_id = v_trainer_user AND al.result IN ('trainer','staff','accepted')
         AND al.created_at >= v_day_start - interval '1 hour' AND al.created_at < v_day_end + interval '1 hour'
         AND COALESCE(al.captured_at, al.created_at) >= v_day_start AND COALESCE(al.captured_at, al.created_at) < v_day_end
      UNION
      SELECT sa.check_in FROM public.staff_attendance sa
       WHERE sa.user_id = v_trainer_user AND sa.check_in >= v_day_start AND sa.check_in < v_day_end;

    -- Duty windows: one per clocked-in shift block that day.
    FOR s IN SELECT sa.check_in, sa.check_out, sa.scheduled_end_at,
                    lead(sa.check_in) OVER (ORDER BY sa.check_in) AS next_in
               FROM public.staff_attendance sa
              WHERE sa.user_id = v_trainer_user AND sa.check_in >= v_day_start AND sa.check_in < v_day_end
              ORDER BY sa.check_in LOOP
      SELECT max(at) INTO v_last_scan FROM _pt_t
       WHERE at >= s.check_in AND (s.next_in IS NULL OR at < s.next_in);
      v_end := GREATEST(COALESCE(s.scheduled_end_at, s.check_in), COALESCE(v_last_scan, s.check_in)) + v_window;
      -- Clocked out before the shift ended and never scanned back in: duty ends at clock-out.
      IF s.check_out IS NOT NULL AND s.check_out < COALESCE(s.scheduled_end_at, s.check_out + interval '1 second')
         AND (v_last_scan IS NULL OR v_last_scan <= s.check_out + interval '15 minutes') THEN
        v_end := LEAST(v_end, s.check_out + v_window);
      ELSIF s.check_out IS NOT NULL AND s.scheduled_end_at IS NULL THEN
        v_end := GREATEST(s.check_out, COALESCE(v_last_scan, s.check_out)) + v_window;
      END IF;
      IF s.next_in IS NOT NULL THEN v_end := LEAST(v_end, s.next_in); END IF;
      INSERT INTO _pt_ti VALUES (s.check_in, LEAST(v_end, v_day_end));
    END LOOP;
  END IF;

  SELECT min(at) INTO v_m0 FROM _pt_m;
  IF v_m0 IS NULL THEN RETURN 'no_member_presence'; END IF;

  FOR v_m IN SELECT at FROM _pt_m ORDER BY at LOOP
    v_pair_t := NULL;
    SELECT max(i.s) INTO v_pair_t FROM _pt_ti i WHERE v_m BETWEEN i.s AND i.e;
    IF v_pair_t IS NOT NULL THEN v_pair_m := v_m; v_reason := 'on_duty'; EXIT; END IF;
    SELECT t.at INTO v_pair_t FROM _pt_t t WHERE t.at BETWEEN v_m - v_window AND v_m + v_window
      ORDER BY (t.at > v_m), abs(extract(epoch FROM t.at - v_m)) LIMIT 1;
    IF v_pair_t IS NOT NULL THEN v_pair_m := v_m; v_reason := 'co_arrival'; EXIT; END IF;
  END LOOP;

  SELECT COALESCE(p.full_name,'Member') INTO v_member_name FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.id = v_pkg.member_id;
  SELECT COALESCE(p.full_name,'Trainer') INTO v_trainer_name FROM public.profiles p WHERE p.id = v_trainer_user;

  IF v_pair_m IS NOT NULL THEN
    v_gap := GREATEST(0, round(extract(epoch FROM (v_pair_t - v_pair_m)) / 60)::int);
    v_outcome := CASE WHEN v_mode = 'review' THEN 'ready_to_confirm' ELSE 'auto_logged' END;

    IF v_outcome = 'auto_logged' THEN
      UPDATE public.pt_sessions SET status = 'completed', updated_at = now(),
             notes = COALESCE(notes || ' · ', '') || 'Auto-marked from gate scans'
       WHERE id = (SELECT id FROM public.pt_sessions WHERE member_pt_package_id = v_pkg.id AND status = 'scheduled'
                     AND timezone('Asia/Kolkata', scheduled_at)::date = p_date ORDER BY scheduled_at LIMIT 1)
       RETURNING id INTO v_session;
      IF v_session IS NULL THEN
        INSERT INTO public.pt_sessions (member_pt_package_id, trainer_id, branch_id, scheduled_at, status, notes, duration_minutes)
        VALUES (v_pkg.id, v_pkg.trainer_id, v_pkg.branch_id, GREATEST(v_pair_m, v_pair_t), 'completed',
                format('Auto-marked from gate scans (%s; member %s, trainer %s)',
                       CASE WHEN v_reason = 'on_duty' THEN 'trainer on duty' ELSE 'arrived together' END,
                       to_char(timezone('Asia/Kolkata', v_pair_m), 'HH24:MI'), to_char(timezone('Asia/Kolkata', v_pair_t), 'HH24:MI')), 60)
        RETURNING id INTO v_session;
      END IF;
      IF v_pkg.package_type = 'session_based' THEN
        UPDATE public.member_pt_packages
           SET sessions_used = COALESCE(sessions_used,0) + 1,
               sessions_remaining = GREATEST(0, COALESCE(sessions_remaining,0) - 1),
               status = CASE WHEN COALESCE(sessions_remaining,0) - 1 <= 0 THEN 'exhausted'::pt_package_status ELSE status END,
               updated_at = now()
         WHERE id = v_pkg.id;
      END IF;
    END IF;

    INSERT INTO public.pt_auto_attendance_log (branch_id, member_pt_package_id, member_id, trainer_id, session_date,
        member_first_at, trainer_first_at, arrival_order, gap_minutes, outcome, pt_session_id, match_reason)
    VALUES (v_pkg.branch_id, v_pkg.id, v_pkg.member_id, v_pkg.trainer_id, p_date, v_pair_m, v_pair_t,
        CASE WHEN v_pair_t > v_pair_m THEN 'member_first' ELSE 'trainer_first' END, v_gap, v_outcome, v_session, v_reason)
    ON CONFLICT (member_pt_package_id, session_date) DO UPDATE SET
        member_first_at = EXCLUDED.member_first_at, trainer_first_at = EXCLUDED.trainer_first_at,
        arrival_order = EXCLUDED.arrival_order, gap_minutes = EXCLUDED.gap_minutes, match_reason = EXCLUDED.match_reason,
        outcome = EXCLUDED.outcome, pt_session_id = EXCLUDED.pt_session_id, updated_at = now()
    RETURNING * INTO v_log;

    IF v_log.arrival_order = 'member_first' AND v_gap >= v_late AND COALESCE((v_cfg->>'notify_manager')::boolean, true)
       AND v_log.manager_alert_kind IS DISTINCT FROM 'late' THEN
      PERFORM public._pt_auto_alert_managers(v_pkg.branch_id, 'Trainer arrived late for PT',
        format('%s arrived %s min after client %s (%s).', v_trainer_name, v_gap, v_member_name, to_char(timezone('Asia/Kolkata', v_pair_m), 'HH24:MI')),
        jsonb_build_object('kind','pt_trainer_late','log_id',v_log.id,'gap_minutes',v_gap,'member_id',v_pkg.member_id,'trainer_id',v_pkg.trainer_id));
      UPDATE public.pt_auto_attendance_log SET manager_alerted_at = now(), manager_alert_kind = 'late' WHERE id = v_log.id;
    END IF;
    RETURN v_outcome;
  END IF;

  -- Not paired.
  SELECT min(at) INTO v_t1 FROM _pt_t WHERE at > v_m0;
  IF v_t1 IS NOT NULL THEN
    v_gap := round(extract(epoch FROM (v_t1 - v_m0)) / 60)::int;
    INSERT INTO public.pt_auto_attendance_log (branch_id, member_pt_package_id, member_id, trainer_id, session_date,
        member_first_at, trainer_first_at, arrival_order, gap_minutes, outcome, match_reason)
    VALUES (v_pkg.branch_id, v_pkg.id, v_pkg.member_id, v_pkg.trainer_id, p_date, v_m0, v_t1, 'member_first', v_gap, 'needs_review', 'trainer_very_late')
    ON CONFLICT (member_pt_package_id, session_date) DO UPDATE SET trainer_first_at = EXCLUDED.trainer_first_at,
        gap_minutes = EXCLUDED.gap_minutes, arrival_order = 'member_first', outcome = 'needs_review', match_reason = 'trainer_very_late', updated_at = now()
    RETURNING * INTO v_log;
    IF COALESCE((v_cfg->>'notify_manager')::boolean, true) AND v_log.manager_alert_kind IS DISTINCT FROM 'late' THEN
      PERFORM public._pt_auto_alert_managers(v_pkg.branch_id, 'Trainer very late for PT — please review',
        format('%s arrived %s min after client %s (%s). Not marked automatically — confirm or dismiss in PT Attendance.',
               v_trainer_name, v_gap, v_member_name, to_char(timezone('Asia/Kolkata', v_m0), 'HH24:MI')),
        jsonb_build_object('kind','pt_trainer_very_late','log_id',v_log.id,'gap_minutes',v_gap));
      UPDATE public.pt_auto_attendance_log SET manager_alerted_at = now(), manager_alert_kind = 'late' WHERE id = v_log.id;
    END IF;
    RETURN 'needs_review';
  END IF;

  SELECT max(at) INTO v_tany FROM _pt_t;
  IF v_tany IS NOT NULL THEN
    -- Trainer was in earlier but duty was over when the client arrived.
    INSERT INTO public.pt_auto_attendance_log (branch_id, member_pt_package_id, member_id, trainer_id, session_date,
        member_first_at, trainer_first_at, arrival_order, outcome, match_reason)
    VALUES (v_pkg.branch_id, v_pkg.id, v_pkg.member_id, v_pkg.trainer_id, p_date, v_m0, v_tany, 'trainer_first', 'needs_review', 'outside_duty')
    ON CONFLICT (member_pt_package_id, session_date) DO UPDATE SET trainer_first_at = EXCLUDED.trainer_first_at,
        arrival_order = 'trainer_first', outcome = 'needs_review', match_reason = 'outside_duty', updated_at = now();
    RETURN 'outside_duty';
  END IF;

  INSERT INTO public.pt_auto_attendance_log (branch_id, member_pt_package_id, member_id, trainer_id, session_date,
      member_first_at, arrival_order, outcome)
  VALUES (v_pkg.branch_id, v_pkg.id, v_pkg.member_id, v_pkg.trainer_id, p_date, v_m0, 'member_first', 'awaiting_trainer')
  ON CONFLICT (member_pt_package_id, session_date) DO NOTHING;
  RETURN 'awaiting_trainer';
END;
$$;

-- Internal apply (no guards): mark / dismiss / reverse
CREATE OR REPLACE FUNCTION public._pt_auto_apply(p_log_id uuid, p_action text, p_note text, p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_log public.pt_auto_attendance_log%ROWTYPE; v_pkg public.member_pt_packages%ROWTYPE; v_session uuid;
BEGIN
  SELECT * INTO v_log FROM public.pt_auto_attendance_log WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_pkg FROM public.member_pt_packages WHERE id = v_log.member_pt_package_id FOR UPDATE;

  IF p_action IN ('confirm','mark') THEN
    IF v_log.outcome NOT IN ('needs_review','awaiting_trainer','trainer_no_show','dismissed','ready_to_confirm','reversed') THEN RAISE EXCEPTION 'already_marked'; END IF;
    IF v_pkg.status <> 'active' THEN RAISE EXCEPTION 'package_not_active'; END IF;
    IF v_pkg.package_type = 'session_based' AND COALESCE(v_pkg.sessions_remaining,0) <= 0 THEN RAISE EXCEPTION 'no_sessions_left'; END IF;
    IF EXISTS (SELECT 1 FROM public.pt_sessions ps WHERE ps.member_pt_package_id = v_pkg.id
                 AND timezone('Asia/Kolkata', ps.scheduled_at)::date = v_log.session_date
                 AND ps.status NOT IN ('scheduled','cancelled','rescheduled')) THEN
      RAISE EXCEPTION 'session_already_logged';
    END IF;
    INSERT INTO public.pt_sessions (member_pt_package_id, trainer_id, branch_id, scheduled_at, status, notes, duration_minutes)
    VALUES (v_pkg.id, v_log.trainer_id, v_log.branch_id,
            COALESCE(GREATEST(v_log.trainer_first_at, v_log.member_first_at), v_log.member_first_at, now()), 'completed',
            'Confirmed from PT auto attendance' || COALESCE(' · ' || p_note, ''), 60)
    RETURNING id INTO v_session;
    IF v_pkg.package_type = 'session_based' THEN
      UPDATE public.member_pt_packages SET sessions_used = COALESCE(sessions_used,0)+1,
        sessions_remaining = GREATEST(0, COALESCE(sessions_remaining,0)-1),
        status = CASE WHEN COALESCE(sessions_remaining,0)-1 <= 0 THEN 'exhausted'::pt_package_status ELSE status END, updated_at = now()
       WHERE id = v_pkg.id;
    END IF;
    UPDATE public.pt_auto_attendance_log SET outcome = 'confirmed', pt_session_id = v_session, resolved_by = p_actor, resolved_at = now(), resolution_note = p_note, updated_at = now() WHERE id = p_log_id;
  ELSIF p_action = 'dismiss' THEN
    IF v_log.outcome NOT IN ('needs_review','awaiting_trainer','trainer_no_show','ready_to_confirm') THEN RAISE EXCEPTION 'cannot_dismiss_%', v_log.outcome; END IF;
    UPDATE public.pt_auto_attendance_log SET outcome = 'dismissed', resolved_by = p_actor, resolved_at = now(), resolution_note = p_note, updated_at = now() WHERE id = p_log_id;
  ELSIF p_action IN ('reverse','undo') THEN
    IF v_log.outcome NOT IN ('auto_logged','confirmed') THEN RAISE EXCEPTION 'cannot_reverse_%', v_log.outcome; END IF;
    IF v_log.session_date < timezone('Asia/Kolkata', now())::date - 7 THEN RAISE EXCEPTION 'too_old_to_reverse'; END IF;
    UPDATE public.pt_sessions SET status = 'cancelled', cancelled_reason = COALESCE(p_note, 'Reversed from PT auto attendance'), updated_at = now()
     WHERE id = v_log.pt_session_id AND status IN ('completed','late');
    IF FOUND AND v_pkg.package_type = 'session_based' THEN
      UPDATE public.member_pt_packages SET sessions_used = GREATEST(0, COALESCE(sessions_used,0)-1),
        sessions_remaining = COALESCE(sessions_remaining,0)+1,
        status = CASE WHEN status = 'exhausted' THEN 'active'::pt_package_status ELSE status END, updated_at = now()
       WHERE id = v_pkg.id;
    END IF;
    UPDATE public.pt_auto_attendance_log SET outcome = 'reversed', resolved_by = p_actor, resolved_at = now(), resolution_note = p_note, updated_at = now() WHERE id = p_log_id;
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public._pt_auto_apply(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pt_auto_apply(uuid, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._pt_is_branch_manager(p_user uuid, p_branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(p_user, ARRAY['owner','admin']::app_role[])
      OR (public.has_any_role(p_user, ARRAY['manager']::app_role[]) AND p_branch IN (SELECT public.managed_branch_ids(p_user)));
$$;
REVOKE EXECUTE ON FUNCTION public._pt_is_branch_manager(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pt_is_branch_manager(uuid, uuid) TO service_role;

-- Staff/manager resolve; a trainer may only confirm their own ready_to_confirm rows.
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_resolve(p_log_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_log public.pt_auto_attendance_log%ROWTYPE; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_log FROM public.pt_auto_attendance_log WHERE id = p_log_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.rpc_guard_applies('pt_auto_attendance_resolve') THEN
    IF public._pt_is_branch_manager(v_uid, v_log.branch_id)
       OR (public.has_any_role(v_uid, ARRAY['staff']::app_role[])
           AND EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.user_id = v_uid AND sb.branch_id = v_log.branch_id)) THEN
      NULL;
    ELSIF EXISTS (SELECT 1 FROM public.trainers t WHERE t.id = v_log.trainer_id AND t.user_id = v_uid)
          AND p_action = 'confirm' AND v_log.outcome = 'ready_to_confirm' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'not_authorized';
    END IF;
  END IF;
  PERFORM public._pt_auto_apply(p_log_id, p_action, p_note, v_uid);
  RETURN jsonb_build_object('success', true, 'log_id', p_log_id, 'action', p_action);
END; $$;

-- Trainer requests a correction; manager approves.
CREATE OR REPLACE FUNCTION public.pt_attendance_request_correction(p_log_id uuid, p_action text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_log public.pt_auto_attendance_log%ROWTYPE; v_uid uuid := auth.uid(); v_id uuid; v_req uuid;
  v_mname text; v_tname text;
BEGIN
  SELECT * INTO v_log FROM public.pt_auto_attendance_log WHERE id = p_log_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.rpc_guard_applies('pt_attendance_request_correction') THEN
    IF NOT EXISTS (SELECT 1 FROM public.trainers t WHERE t.id = v_log.trainer_id AND t.user_id = v_uid)
       AND NOT public._pt_is_branch_manager(v_uid, v_log.branch_id) THEN
      RAISE EXCEPTION 'not_your_client';
    END IF;
  END IF;
  IF p_action NOT IN ('mark','undo') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  IF char_length(coalesce(trim(p_reason),'')) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF p_action = 'mark' AND v_log.outcome IN ('auto_logged','confirmed') THEN RAISE EXCEPTION 'already_marked'; END IF;
  IF p_action = 'undo' AND v_log.outcome NOT IN ('auto_logged','confirmed') THEN RAISE EXCEPTION 'nothing_to_undo'; END IF;
  IF EXISTS (SELECT 1 FROM public.pt_attendance_corrections WHERE log_id = p_log_id AND status = 'pending') THEN RAISE EXCEPTION 'request_already_pending'; END IF;

  SELECT COALESCE(p.full_name,'Member') INTO v_mname FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.id = v_log.member_id;
  SELECT COALESCE(p.full_name,'Trainer') INTO v_tname FROM public.trainers t LEFT JOIN public.profiles p ON p.id = t.user_id WHERE t.id = v_log.trainer_id;

  INSERT INTO public.pt_attendance_corrections (log_id, branch_id, trainer_id, requested_by, action, reason)
  VALUES (p_log_id, v_log.branch_id, v_log.trainer_id, v_uid, p_action, trim(p_reason)) RETURNING id INTO v_id;

  INSERT INTO public.approval_requests (branch_id, approval_type, reference_type, reference_id, requested_by, request_data, status)
  VALUES (v_log.branch_id, 'pt_attendance_correction', 'pt_attendance_correction', v_id, v_uid,
    jsonb_build_object('memberName', v_mname, 'trainerName', v_tname, 'action', p_action, 'reason', trim(p_reason),
                       'sessionDate', v_log.session_date, 'memberIn', v_log.member_first_at, 'trainerIn', v_log.trainer_first_at),
    'pending') RETURNING id INTO v_req;
  UPDATE public.pt_attendance_corrections SET approval_request_id = v_req WHERE id = v_id;

  PERFORM public._pt_auto_alert_managers(v_log.branch_id, 'PT attendance correction requested',
    format('%s asks to %s the PT session for %s on %s: %s', v_tname, CASE WHEN p_action='mark' THEN 'mark' ELSE 'undo' END,
           v_mname, to_char(v_log.session_date, 'DD Mon'), trim(p_reason)),
    jsonb_build_object('kind','pt_correction_requested','correction_id',v_id));
  RETURN jsonb_build_object('success', true, 'correction_id', v_id);
END; $$;
REVOKE EXECUTE ON FUNCTION public.pt_attendance_request_correction(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_attendance_request_correction(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pt_attendance_decide_correction(p_correction_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.pt_attendance_corrections%ROWTYPE; v_uid uuid := auth.uid(); v_trainer_user uuid;
BEGIN
  SELECT * INTO c FROM public.pt_attendance_corrections WHERE id = p_correction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.rpc_guard_applies('pt_attendance_decide_correction') THEN
    IF NOT public._pt_is_branch_manager(v_uid, c.branch_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
    IF c.requested_by = v_uid AND NOT public.has_any_role(v_uid, ARRAY['owner','admin']::app_role[]) THEN RAISE EXCEPTION 'cannot_approve_own_request'; END IF;
  END IF;
  IF c.status <> 'pending' THEN RAISE EXCEPTION 'already_decided'; END IF;
  IF p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'invalid_decision'; END IF;

  IF p_decision = 'approve' THEN
    PERFORM public._pt_auto_apply(c.log_id, c.action, 'Approved correction: ' || c.reason, v_uid);
  END IF;
  UPDATE public.pt_attendance_corrections SET status = CASE WHEN p_decision='approve' THEN 'approved' ELSE 'rejected' END,
    decided_by = v_uid, decided_at = now(), decision_note = p_note, updated_at = now() WHERE id = c.id;
  IF c.approval_request_id IS NOT NULL THEN
    UPDATE public.approval_requests SET status = CASE WHEN p_decision='approve' THEN 'approved'::approval_status ELSE 'rejected'::approval_status END,
      reviewed_by = v_uid, reviewed_at = now(), review_notes = p_note,
      side_effects_committed_at = CASE WHEN p_decision='approve' THEN now() ELSE NULL END, updated_at = now()
     WHERE id = c.approval_request_id;
  END IF;

  SELECT t.user_id INTO v_trainer_user FROM public.trainers t WHERE t.id = c.trainer_id;
  BEGIN
    INSERT INTO public.notifications (user_id, branch_id, title, message, type, category, action_url, metadata)
    VALUES (COALESCE(c.requested_by, v_trainer_user), c.branch_id,
      CASE WHEN p_decision='approve' THEN 'PT correction approved' ELSE 'PT correction rejected' END,
      CASE WHEN p_decision='approve' THEN 'Your PT attendance correction was approved.' ELSE 'Your PT attendance correction was rejected' || COALESCE(': ' || p_note, '.') END,
      CASE WHEN p_decision='approve' THEN 'success' ELSE 'warning' END, 'pt_attendance', '/trainer-dashboard',
      jsonb_build_object('kind','pt_correction_decided','correction_id',c.id,'decision',p_decision));
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN jsonb_build_object('success', true, 'decision', p_decision);
END; $$;
REVOKE EXECUTE ON FUNCTION public.pt_attendance_decide_correction(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_attendance_decide_correction(uuid, text, text) TO authenticated, service_role;

-- Boards
DROP FUNCTION IF EXISTS public.pt_auto_attendance_board(uuid, date);
CREATE FUNCTION public.pt_auto_attendance_board(p_branch_id uuid, p_date date)
RETURNS TABLE (id uuid, member_id uuid, member_name text, member_code text, trainer_id uuid, trainer_name text,
  member_first_at timestamptz, trainer_first_at timestamptz, arrival_order text, gap_minutes int, outcome text,
  match_reason text, pt_session_id uuid, manager_alert_kind text, resolution_note text,
  correction_id uuid, correction_action text, correction_status text, correction_reason text, correction_requested_by uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('pt_auto_attendance_board') THEN
    PERFORM public.assert_branch_staff(p_branch_id, true, 'view PT attendance');
  END IF;
  RETURN QUERY
  SELECT l.id, l.member_id, mp.full_name, m.member_code, l.trainer_id, tp.full_name,
         l.member_first_at, l.trainer_first_at, l.arrival_order, l.gap_minutes, l.outcome,
         l.match_reason, l.pt_session_id, l.manager_alert_kind, l.resolution_note,
         c.id, c.action, c.status, c.reason, c.requested_by
  FROM public.pt_auto_attendance_log l
  JOIN public.members m ON m.id = l.member_id
  LEFT JOIN public.profiles mp ON mp.id = m.user_id
  LEFT JOIN public.trainers t ON t.id = l.trainer_id
  LEFT JOIN public.profiles tp ON tp.id = t.user_id
  LEFT JOIN LATERAL (SELECT * FROM public.pt_attendance_corrections pc WHERE pc.log_id = l.id ORDER BY pc.created_at DESC LIMIT 1) c ON true
  WHERE l.branch_id = p_branch_id AND l.session_date = p_date
  ORDER BY l.member_first_at DESC NULLS LAST;
END; $$;
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_board(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_board(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pt_auto_attendance_my_board(p_date date)
RETURNS TABLE (id uuid, member_id uuid, member_name text, member_code text,
  member_first_at timestamptz, trainer_first_at timestamptz, arrival_order text, gap_minutes int, outcome text,
  match_reason text, pt_session_id uuid, correction_id uuid, correction_action text, correction_status text,
  correction_reason text, correction_note text, mode text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('pt_auto_attendance_my_board') THEN
    IF NOT EXISTS (SELECT 1 FROM public.trainers t WHERE t.user_id = auth.uid()) THEN RAISE EXCEPTION 'not_a_trainer'; END IF;
  END IF;
  RETURN QUERY
  SELECT l.id, l.member_id, mp.full_name, m.member_code,
         l.member_first_at, l.trainer_first_at, l.arrival_order, l.gap_minutes, l.outcome,
         l.match_reason, l.pt_session_id, c.id, c.action, c.status, c.reason, c.decision_note,
         public.pt_auto_attendance_config(l.branch_id)->>'mode'
  FROM public.pt_auto_attendance_log l
  JOIN public.trainers t ON t.id = l.trainer_id AND t.user_id = auth.uid()
  JOIN public.members m ON m.id = l.member_id
  LEFT JOIN public.profiles mp ON mp.id = m.user_id
  LEFT JOIN LATERAL (SELECT * FROM public.pt_attendance_corrections pc WHERE pc.log_id = l.id ORDER BY pc.created_at DESC LIMIT 1) c ON true
  WHERE l.session_date = p_date
  ORDER BY l.member_first_at DESC NULLS LAST;
END; $$;
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_my_board(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_my_board(date) TO authenticated, service_role;