-- Automatic PT attendance: member + assigned trainer at the gym within a window (default 30 min).
CREATE TABLE public.pt_auto_attendance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL,
  member_pt_package_id uuid NOT NULL REFERENCES public.member_pt_packages(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  trainer_id uuid NOT NULL,
  session_date date NOT NULL,
  member_first_at timestamptz,
  trainer_first_at timestamptz,
  arrival_order text,
  gap_minutes integer,
  outcome text NOT NULL DEFAULT 'awaiting_trainer',
  pt_session_id uuid,
  manager_alerted_at timestamptz,
  manager_alert_kind text,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pt_auto_attendance_outcome_chk CHECK (outcome IN ('awaiting_trainer','auto_logged','needs_review','trainer_no_show','confirmed','dismissed','reversed')),
  CONSTRAINT pt_auto_attendance_order_chk CHECK (arrival_order IS NULL OR arrival_order IN ('member_first','trainer_first')),
  UNIQUE (member_pt_package_id, session_date)
);
GRANT SELECT ON public.pt_auto_attendance_log TO authenticated;
GRANT ALL ON public.pt_auto_attendance_log TO service_role;
ALTER TABLE public.pt_auto_attendance_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Branch staff read PT auto attendance" ON public.pt_auto_attendance_log
  FOR SELECT TO authenticated
  USING (
    (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]))
    OR branch_id IN (SELECT public.managed_branch_ids(auth.uid()))
    OR branch_id IN (SELECT sb.branch_id FROM public.staff_branches sb WHERE sb.user_id = (SELECT auth.uid()))
  );
CREATE INDEX pt_auto_attendance_log_branch_date_idx ON public.pt_auto_attendance_log (branch_id, session_date DESC);
CREATE INDEX pt_auto_attendance_log_awaiting_idx ON public.pt_auto_attendance_log (session_date) WHERE outcome = 'awaiting_trainer';

CREATE INDEX IF NOT EXISTS idx_access_logs_profile_created ON public.access_logs (profile_id, created_at DESC) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_member_pt_packages_active_member ON public.member_pt_packages (member_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_member_pt_packages_active_trainer ON public.member_pt_packages (trainer_id) WHERE status = 'active';

-- Config with safe defaults (settings key pt_auto_attendance, branch row overrides global row)
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_config(p_branch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('enabled', true, 'window_minutes', 30, 'late_alert_minutes', 10, 'notify_manager', true)
      || COALESCE((SELECT value FROM public.settings WHERE branch_id IS NULL AND key = 'pt_auto_attendance' AND jsonb_typeof(value) = 'object'), '{}'::jsonb)
      || COALESCE((SELECT value FROM public.settings WHERE branch_id = p_branch_id AND key = 'pt_auto_attendance' AND jsonb_typeof(value) = 'object'), '{}'::jsonb);
$$;
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_config(uuid) TO authenticated, service_role;

-- Internal: alert branch managers (owners if branch has no manager) in-app
CREATE OR REPLACE FUNCTION public._pt_auto_alert_managers(p_branch_id uuid, p_title text, p_message text, p_meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  INSERT INTO public.notifications (user_id, branch_id, title, message, type, category, action_url, metadata)
  SELECT DISTINCT ur.user_id, p_branch_id, p_title, p_message, 'warning', 'pt_attendance', '/pt-sessions?tab=attendance', p_meta
  FROM public.user_roles ur
  WHERE ur.role = 'manager'
    AND (EXISTS (SELECT 1 FROM public.branch_managers bm WHERE bm.user_id = ur.user_id AND bm.branch_id = p_branch_id)
         OR EXISTS (SELECT 1 FROM public.staff_branches sb WHERE sb.user_id = ur.user_id AND sb.branch_id = p_branch_id));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    INSERT INTO public.notifications (user_id, branch_id, title, message, type, category, action_url, metadata)
    SELECT DISTINCT ur.user_id, p_branch_id, p_title, p_message, 'warning', 'pt_attendance', '/pt-sessions?tab=attendance', p_meta
    FROM public.user_roles ur WHERE ur.role = 'owner';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pt auto alert failed: %', SQLERRM;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._pt_auto_alert_managers(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pt_auto_alert_managers(uuid, text, text, jsonb) TO service_role;

-- Core evaluator for one package on one IST date. Idempotent; safe to call on every scan.
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_evaluate(p_package_id uuid, p_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pkg public.member_pt_packages%ROWTYPE;
  v_cfg jsonb;
  v_window interval;
  v_late int;
  v_trainer_user uuid;
  v_trainer_name text;
  v_member_name text;
  v_log public.pt_auto_attendance_log%ROWTYPE;
  v_m timestamptz;
  v_m0 timestamptz;
  v_t1 timestamptz;
  v_tfirst timestamptz;
  v_pair_m timestamptz;
  v_pair_t timestamptz;
  v_gap int;
  v_session uuid;
  v_day_start timestamptz := (p_date::timestamp) AT TIME ZONE 'Asia/Kolkata';
  v_day_end timestamptz := ((p_date + 1)::timestamp) AT TIME ZONE 'Asia/Kolkata';
BEGIN
  SELECT * INTO v_pkg FROM public.member_pt_packages WHERE id = p_package_id;
  IF NOT FOUND OR v_pkg.status <> 'active' OR v_pkg.trainer_id IS NULL THEN RETURN 'skip_package'; END IF;
  IF v_pkg.start_date IS NOT NULL AND p_date < v_pkg.start_date THEN RETURN 'skip_not_started'; END IF;
  IF v_pkg.package_type = 'monthly' AND v_pkg.expiry_date IS NOT NULL AND p_date > v_pkg.expiry_date THEN RETURN 'skip_expired'; END IF;
  IF v_pkg.package_type = 'session_based' AND COALESCE(v_pkg.sessions_remaining,0) <= 0 THEN RETURN 'skip_no_sessions'; END IF;

  v_cfg := public.pt_auto_attendance_config(v_pkg.branch_id);
  IF NOT COALESCE((v_cfg->>'enabled')::boolean, true) THEN RETURN 'disabled'; END IF;
  v_window := make_interval(mins => GREATEST(5, LEAST(180, COALESCE((v_cfg->>'window_minutes')::int, 30))));
  v_late := COALESCE((v_cfg->>'late_alert_minutes')::int, 10);

  SELECT * INTO v_log FROM public.pt_auto_attendance_log WHERE member_pt_package_id = p_package_id AND session_date = p_date;
  IF FOUND AND v_log.outcome IN ('auto_logged','confirmed','dismissed','reversed','needs_review') THEN RETURN 'already_' || v_log.outcome; END IF;

  -- A session already recorded manually that day wins.
  IF EXISTS (SELECT 1 FROM public.pt_sessions ps WHERE ps.member_pt_package_id = p_package_id
               AND timezone('Asia/Kolkata', ps.scheduled_at)::date = p_date
               AND ps.status NOT IN ('scheduled','cancelled','rescheduled')) THEN
    RETURN 'already_manual';
  END IF;

  SELECT t.user_id INTO v_trainer_user FROM public.trainers t WHERE t.id = v_pkg.trainer_id;

  -- Member arrival times (gate entry scans + attendance check-ins)
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
     WHERE ma.member_id = v_pkg.member_id AND ma.check_in >= v_day_start AND ma.check_in < v_day_end;

  IF v_trainer_user IS NOT NULL THEN
    INSERT INTO _pt_t
      SELECT COALESCE(al.captured_at, al.created_at) FROM public.access_logs al
       WHERE al.profile_id = v_trainer_user AND al.result IN ('trainer','staff','accepted')
         AND al.created_at >= v_day_start - interval '1 hour' AND al.created_at < v_day_end + interval '1 hour'
         AND COALESCE(al.captured_at, al.created_at) >= v_day_start AND COALESCE(al.captured_at, al.created_at) < v_day_end
      UNION
      SELECT sa.check_in FROM public.staff_attendance sa
       WHERE sa.user_id = v_trainer_user AND sa.check_in >= v_day_start AND sa.check_in < v_day_end;
    INSERT INTO _pt_ti
      SELECT sa.check_in, COALESCE(sa.check_out, LEAST(now(), v_day_end)) FROM public.staff_attendance sa
       WHERE sa.user_id = v_trainer_user AND sa.check_in < v_day_end AND COALESCE(sa.check_out, now()) >= v_day_start;
  END IF;

  SELECT min(at) INTO v_m0 FROM _pt_m;
  IF v_m0 IS NULL THEN RETURN 'no_member_presence'; END IF;

  -- Pairing: any member arrival with trainer arrival within the window, or trainer on shift at that moment.
  FOR v_m IN SELECT at FROM _pt_m ORDER BY at LOOP
    SELECT t.at INTO v_pair_t FROM _pt_t t WHERE t.at BETWEEN v_m - v_window AND v_m + v_window
      ORDER BY (t.at > v_m), abs(extract(epoch FROM t.at - v_m)) LIMIT 1;
    IF v_pair_t IS NULL AND EXISTS (SELECT 1 FROM _pt_ti i WHERE v_m BETWEEN i.s AND i.e) THEN
      SELECT max(i.s) INTO v_pair_t FROM _pt_ti i WHERE v_m BETWEEN i.s AND i.e;
    END IF;
    IF v_pair_t IS NOT NULL THEN v_pair_m := v_m; EXIT; END IF;
  END LOOP;

  SELECT COALESCE(p.full_name,'Member') INTO v_member_name FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.id = v_pkg.member_id;
  SELECT COALESCE(p.full_name,'Trainer') INTO v_trainer_name FROM public.profiles p WHERE p.id = v_trainer_user;

  IF v_pair_m IS NOT NULL THEN
    v_gap := GREATEST(0, round(extract(epoch FROM (v_pair_t - v_pair_m)) / 60)::int);

    -- Reuse a scheduled session for the day if one exists, else create one.
    UPDATE public.pt_sessions SET status = 'completed', updated_at = now(),
           notes = COALESCE(notes || ' · ', '') || 'Auto-marked from gate scans'
     WHERE id = (SELECT id FROM public.pt_sessions WHERE member_pt_package_id = v_pkg.id AND status = 'scheduled'
                   AND timezone('Asia/Kolkata', scheduled_at)::date = p_date ORDER BY scheduled_at LIMIT 1)
     RETURNING id INTO v_session;
    IF v_session IS NULL THEN
      INSERT INTO public.pt_sessions (member_pt_package_id, trainer_id, branch_id, scheduled_at, status, notes, duration_minutes)
      VALUES (v_pkg.id, v_pkg.trainer_id, v_pkg.branch_id, GREATEST(v_pair_m, v_pair_t), 'completed',
              format('Auto-marked from gate scans (member %s, trainer %s)',
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

    INSERT INTO public.pt_auto_attendance_log (branch_id, member_pt_package_id, member_id, trainer_id, session_date,
        member_first_at, trainer_first_at, arrival_order, gap_minutes, outcome, pt_session_id)
    VALUES (v_pkg.branch_id, v_pkg.id, v_pkg.member_id, v_pkg.trainer_id, p_date, v_pair_m, v_pair_t,
        CASE WHEN v_pair_t > v_pair_m THEN 'member_first' ELSE 'trainer_first' END, v_gap, 'auto_logged', v_session)
    ON CONFLICT (member_pt_package_id, session_date) DO UPDATE SET
        member_first_at = EXCLUDED.member_first_at, trainer_first_at = EXCLUDED.trainer_first_at,
        arrival_order = EXCLUDED.arrival_order, gap_minutes = EXCLUDED.gap_minutes,
        outcome = 'auto_logged', pt_session_id = EXCLUDED.pt_session_id, updated_at = now()
    RETURNING * INTO v_log;

    IF v_log.arrival_order = 'member_first' AND v_gap >= v_late AND COALESCE((v_cfg->>'notify_manager')::boolean, true)
       AND v_log.manager_alert_kind IS DISTINCT FROM 'late' THEN
      PERFORM public._pt_auto_alert_managers(v_pkg.branch_id,
        'Trainer arrived late for PT',
        format('%s arrived %s min after client %s (%s). Session was marked automatically.',
               v_trainer_name, v_gap, v_member_name, to_char(timezone('Asia/Kolkata', v_pair_m), 'HH24:MI')),
        jsonb_build_object('kind','pt_trainer_late','log_id',v_log.id,'gap_minutes',v_gap,'member_id',v_pkg.member_id,'trainer_id',v_pkg.trainer_id));
      UPDATE public.pt_auto_attendance_log SET manager_alerted_at = now(), manager_alert_kind = 'late' WHERE id = v_log.id;
    END IF;
    RETURN 'auto_logged';
  END IF;

  -- No pairing. Did the trainer turn up later than the window?
  SELECT min(at) INTO v_t1 FROM _pt_t WHERE at > v_m0;
  IF v_t1 IS NOT NULL THEN
    v_gap := round(extract(epoch FROM (v_t1 - v_m0)) / 60)::int;
    INSERT INTO public.pt_auto_attendance_log (branch_id, member_pt_package_id, member_id, trainer_id, session_date,
        member_first_at, trainer_first_at, arrival_order, gap_minutes, outcome)
    VALUES (v_pkg.branch_id, v_pkg.id, v_pkg.member_id, v_pkg.trainer_id, p_date, v_m0, v_t1, 'member_first', v_gap, 'needs_review')
    ON CONFLICT (member_pt_package_id, session_date) DO UPDATE SET trainer_first_at = EXCLUDED.trainer_first_at,
        gap_minutes = EXCLUDED.gap_minutes, arrival_order = 'member_first', outcome = 'needs_review', updated_at = now()
    RETURNING * INTO v_log;
    IF COALESCE((v_cfg->>'notify_manager')::boolean, true) AND v_log.manager_alert_kind IS DISTINCT FROM 'late' THEN
      PERFORM public._pt_auto_alert_managers(v_pkg.branch_id,
        'Trainer very late for PT — please review',
        format('%s arrived %s min after client %s (%s). Not marked automatically — confirm or dismiss in PT Attendance.',
               v_trainer_name, v_gap, v_member_name, to_char(timezone('Asia/Kolkata', v_m0), 'HH24:MI')),
        jsonb_build_object('kind','pt_trainer_very_late','log_id',v_log.id,'gap_minutes',v_gap));
      UPDATE public.pt_auto_attendance_log SET manager_alerted_at = now(), manager_alert_kind = 'late' WHERE id = v_log.id;
    END IF;
    RETURN 'needs_review';
  END IF;

  -- Member is in, trainer not seen yet. The sweep raises the no-show alert once the window passes.
  SELECT min(at) INTO v_tfirst FROM _pt_t;
  INSERT INTO public.pt_auto_attendance_log (branch_id, member_pt_package_id, member_id, trainer_id, session_date,
      member_first_at, trainer_first_at, arrival_order, outcome)
  VALUES (v_pkg.branch_id, v_pkg.id, v_pkg.member_id, v_pkg.trainer_id, p_date, v_m0, v_tfirst, 'member_first', 'awaiting_trainer')
  ON CONFLICT (member_pt_package_id, session_date) DO NOTHING;
  RETURN 'awaiting_trainer';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_evaluate(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_evaluate(uuid, date) TO service_role;

-- Fan-out helpers
CREATE OR REPLACE FUNCTION public._pt_auto_on_member_presence(p_member_id uuid, p_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.member_pt_packages WHERE member_id = p_member_id AND status = 'active' AND trainer_id IS NOT NULL LOOP
    PERFORM public.pt_auto_attendance_evaluate(r.id, timezone('Asia/Kolkata', p_at)::date);
  END LOOP;
END; $$;
CREATE OR REPLACE FUNCTION public._pt_auto_on_trainer_presence(p_user_id uuid, p_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_date date := timezone('Asia/Kolkata', p_at)::date;
BEGIN
  FOR r IN SELECT mpp.id FROM public.member_pt_packages mpp JOIN public.trainers t ON t.id = mpp.trainer_id
           WHERE t.user_id = p_user_id AND mpp.status = 'active' LOOP
    PERFORM public.pt_auto_attendance_evaluate(r.id, v_date);
  END LOOP;
END; $$;
REVOKE EXECUTE ON FUNCTION public._pt_auto_on_member_presence(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._pt_auto_on_trainer_presence(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pt_auto_on_member_presence(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public._pt_auto_on_trainer_presence(uuid, timestamptz) TO service_role;

-- Triggers: never block a gate scan or check-in.
CREATE OR REPLACE FUNCTION public.tg_pt_auto_access_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF NEW.member_id IS NOT NULL AND NEW.result IN ('member','accepted') THEN
      IF EXISTS (SELECT 1 FROM public.member_pt_packages WHERE member_id = NEW.member_id AND status = 'active') THEN
        PERFORM public._pt_auto_on_member_presence(NEW.member_id, COALESCE(NEW.captured_at, NEW.created_at));
      END IF;
    ELSIF NEW.profile_id IS NOT NULL AND NEW.result IN ('trainer','staff','accepted') THEN
      IF EXISTS (SELECT 1 FROM public.trainers t JOIN public.member_pt_packages m ON m.trainer_id = t.id AND m.status = 'active' WHERE t.user_id = NEW.profile_id) THEN
        PERFORM public._pt_auto_on_trainer_presence(NEW.profile_id, COALESCE(NEW.captured_at, NEW.created_at));
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN PERFORM public.log_error_event('warning','pt_auto_attendance',SQLERRM,'tg_pt_auto_access_log',NULL,'access_logs',NEW.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
  RETURN NULL;
END; $$;
CREATE OR REPLACE FUNCTION public.tg_pt_auto_member_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF COALESCE(NEW.check_in_method,'') <> 'pt_session'
       AND EXISTS (SELECT 1 FROM public.member_pt_packages WHERE member_id = NEW.member_id AND status = 'active') THEN
      PERFORM public._pt_auto_on_member_presence(NEW.member_id, NEW.check_in);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN PERFORM public.log_error_event('warning','pt_auto_attendance',SQLERRM,'tg_pt_auto_member_attendance',NULL,'member_attendance',NEW.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
  RETURN NULL;
END; $$;
CREATE OR REPLACE FUNCTION public.tg_pt_auto_staff_attendance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.trainers t JOIN public.member_pt_packages m ON m.trainer_id = t.id AND m.status = 'active' WHERE t.user_id = NEW.user_id) THEN
      PERFORM public._pt_auto_on_trainer_presence(NEW.user_id, NEW.check_in);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN PERFORM public.log_error_event('warning','pt_auto_attendance',SQLERRM,'tg_pt_auto_staff_attendance',NULL,'staff_attendance',NEW.branch_id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END;
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION public.tg_pt_auto_access_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_pt_auto_member_attendance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_pt_auto_staff_attendance() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER pt_auto_attendance_access_logs AFTER INSERT ON public.access_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_auto_access_log();
CREATE TRIGGER pt_auto_attendance_member_attendance AFTER INSERT ON public.member_attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_auto_member_attendance();
CREATE TRIGGER pt_auto_attendance_staff_attendance AFTER INSERT ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_pt_auto_staff_attendance();

-- Sweep (Automation Brain): trainer no-show alert after the window, plus re-evaluate today's waiting rows.
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_cfg jsonb; v_res text; v_alerts int := 0; v_logged int := 0;
  v_today date := timezone('Asia/Kolkata', now())::date; v_mname text; v_tname text;
BEGIN
  IF public.rpc_guard_applies('pt_auto_attendance_sweep') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  FOR r IN SELECT * FROM public.pt_auto_attendance_log WHERE outcome = 'awaiting_trainer' AND session_date >= v_today - 1 LOOP
    v_res := public.pt_auto_attendance_evaluate(r.member_pt_package_id, r.session_date);
    IF v_res = 'auto_logged' THEN v_logged := v_logged + 1; CONTINUE; END IF;
    IF v_res <> 'awaiting_trainer' THEN CONTINUE; END IF;
    v_cfg := public.pt_auto_attendance_config(r.branch_id);
    IF r.manager_alert_kind IS NULL AND COALESCE((v_cfg->>'notify_manager')::boolean, true)
       AND now() > r.member_first_at + make_interval(mins => COALESCE((v_cfg->>'window_minutes')::int, 30)) THEN
      SELECT COALESCE(p.full_name,'Member') INTO v_mname FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.id = r.member_id;
      SELECT COALESCE(p.full_name,'Trainer') INTO v_tname FROM public.trainers t LEFT JOIN public.profiles p ON p.id = t.user_id WHERE t.id = r.trainer_id;
      PERFORM public._pt_auto_alert_managers(r.branch_id, 'PT client waiting — trainer not in',
        format('%s checked in at %s but trainer %s has not arrived yet.', v_mname, to_char(timezone('Asia/Kolkata', r.member_first_at), 'HH24:MI'), v_tname),
        jsonb_build_object('kind','pt_trainer_not_arrived','log_id',r.id));
      UPDATE public.pt_auto_attendance_log SET manager_alerted_at = now(), manager_alert_kind = 'not_arrived', updated_at = now() WHERE id = r.id;
      v_alerts := v_alerts + 1;
    END IF;
  END LOOP;
  UPDATE public.pt_auto_attendance_log SET outcome = 'trainer_no_show', updated_at = now()
   WHERE outcome = 'awaiting_trainer' AND session_date < v_today;
  RETURN jsonb_build_object('alerts', v_alerts, 'logged', v_logged);
END; $$;
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_sweep() TO service_role;

-- Staff actions: confirm a review item, dismiss, or reverse an auto-marked session.
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_resolve(p_log_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_log public.pt_auto_attendance_log%ROWTYPE; v_pkg public.member_pt_packages%ROWTYPE; v_session uuid;
BEGIN
  SELECT * INTO v_log FROM public.pt_auto_attendance_log WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF public.rpc_guard_applies('pt_auto_attendance_resolve') THEN
    PERFORM public.assert_branch_staff(v_log.branch_id, true, 'resolve PT attendance');
  END IF;
  SELECT * INTO v_pkg FROM public.member_pt_packages WHERE id = v_log.member_pt_package_id FOR UPDATE;

  IF p_action = 'confirm' THEN
    IF v_log.outcome NOT IN ('needs_review','awaiting_trainer','trainer_no_show','dismissed') THEN RAISE EXCEPTION 'cannot_confirm_%', v_log.outcome; END IF;
    IF v_pkg.status <> 'active' THEN RAISE EXCEPTION 'package_not_active'; END IF;
    INSERT INTO public.pt_sessions (member_pt_package_id, trainer_id, branch_id, scheduled_at, status, notes, duration_minutes)
    VALUES (v_pkg.id, v_log.trainer_id, v_log.branch_id, COALESCE(v_log.trainer_first_at, v_log.member_first_at, now()), 'completed',
            'Confirmed from PT auto attendance' || COALESCE(' · ' || p_note, ''), 60)
    RETURNING id INTO v_session;
    IF v_pkg.package_type = 'session_based' THEN
      UPDATE public.member_pt_packages SET sessions_used = COALESCE(sessions_used,0)+1,
        sessions_remaining = GREATEST(0, COALESCE(sessions_remaining,0)-1),
        status = CASE WHEN COALESCE(sessions_remaining,0)-1 <= 0 THEN 'exhausted'::pt_package_status ELSE status END, updated_at = now()
       WHERE id = v_pkg.id;
    END IF;
    UPDATE public.pt_auto_attendance_log SET outcome = 'confirmed', pt_session_id = v_session, resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note, updated_at = now() WHERE id = p_log_id;
  ELSIF p_action = 'dismiss' THEN
    IF v_log.outcome NOT IN ('needs_review','awaiting_trainer','trainer_no_show') THEN RAISE EXCEPTION 'cannot_dismiss_%', v_log.outcome; END IF;
    UPDATE public.pt_auto_attendance_log SET outcome = 'dismissed', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note, updated_at = now() WHERE id = p_log_id;
  ELSIF p_action = 'reverse' THEN
    IF v_log.outcome NOT IN ('auto_logged','confirmed') THEN RAISE EXCEPTION 'cannot_reverse_%', v_log.outcome; END IF;
    IF v_log.session_date < timezone('Asia/Kolkata', now())::date - 7 THEN RAISE EXCEPTION 'too_old_to_reverse'; END IF;
    UPDATE public.pt_sessions SET status = 'cancelled', cancelled_reason = COALESCE(p_note, 'Reversed from PT auto attendance'), updated_at = now()
     WHERE id = v_log.pt_session_id AND status IN ('completed','late');
    IF FOUND AND v_pkg.package_type IN ('session_based') THEN
      UPDATE public.member_pt_packages SET sessions_used = GREATEST(0, COALESCE(sessions_used,0)-1),
        sessions_remaining = COALESCE(sessions_remaining,0)+1,
        status = CASE WHEN status = 'exhausted' THEN 'active'::pt_package_status ELSE status END, updated_at = now()
       WHERE id = v_pkg.id;
    END IF;
    UPDATE public.pt_auto_attendance_log SET outcome = 'reversed', resolved_by = auth.uid(), resolved_at = now(), resolution_note = p_note, updated_at = now() WHERE id = p_log_id;
  ELSE
    RAISE EXCEPTION 'invalid_action';
  END IF;
  RETURN jsonb_build_object('success', true, 'log_id', p_log_id, 'action', p_action);
END; $$;
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_resolve(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_resolve(uuid, text, text) TO authenticated, service_role;

-- Owner/manager toggle
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_set_config(p_branch_id uuid, p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_clean jsonb;
BEGIN
  IF public.rpc_guard_applies('pt_auto_attendance_set_config') THEN
    IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]) THEN
      IF p_branch_id IS NULL OR p_branch_id NOT IN (SELECT public.managed_branch_ids(auth.uid())) THEN RAISE EXCEPTION 'not_authorized'; END IF;
    END IF;
  END IF;
  v_clean := jsonb_build_object(
    'enabled', COALESCE((p_config->>'enabled')::boolean, true),
    'window_minutes', GREATEST(5, LEAST(180, COALESCE((p_config->>'window_minutes')::int, 30))),
    'late_alert_minutes', GREATEST(0, LEAST(120, COALESCE((p_config->>'late_alert_minutes')::int, 10))),
    'notify_manager', COALESCE((p_config->>'notify_manager')::boolean, true));
  UPDATE public.settings SET value = v_clean, updated_at = now() WHERE key = 'pt_auto_attendance' AND branch_id IS NOT DISTINCT FROM p_branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.settings (branch_id, key, value, description) VALUES (p_branch_id, 'pt_auto_attendance', v_clean, 'Automatic PT attendance from gate scans');
  END IF;
  RETURN v_clean;
END; $$;
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_set_config(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_set_config(uuid, jsonb) TO authenticated, service_role;

-- Day board with names for the UI
CREATE OR REPLACE FUNCTION public.pt_auto_attendance_board(p_branch_id uuid, p_date date)
RETURNS TABLE (id uuid, member_id uuid, member_name text, member_code text, trainer_id uuid, trainer_name text,
  member_first_at timestamptz, trainer_first_at timestamptz, arrival_order text, gap_minutes int, outcome text,
  pt_session_id uuid, manager_alert_kind text, resolution_note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('pt_auto_attendance_board') THEN
    PERFORM public.assert_branch_staff(p_branch_id, true, 'view PT attendance');
  END IF;
  RETURN QUERY
  SELECT l.id, l.member_id, mp.full_name, m.member_code, l.trainer_id, tp.full_name,
         l.member_first_at, l.trainer_first_at, l.arrival_order, l.gap_minutes, l.outcome,
         l.pt_session_id, l.manager_alert_kind, l.resolution_note
  FROM public.pt_auto_attendance_log l
  JOIN public.members m ON m.id = l.member_id
  LEFT JOIN public.profiles mp ON mp.id = m.user_id
  LEFT JOIN public.trainers t ON t.id = l.trainer_id
  LEFT JOIN public.profiles tp ON tp.id = t.user_id
  WHERE l.branch_id = p_branch_id AND l.session_date = p_date
  ORDER BY l.member_first_at DESC NULLS LAST;
END; $$;
REVOKE EXECUTE ON FUNCTION public.pt_auto_attendance_board(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pt_auto_attendance_board(uuid, date) TO authenticated, service_role;