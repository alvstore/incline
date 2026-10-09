DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.pt_auto_attendance_evaluate(uuid,date)'::regprocedure);
  v_def := replace(v_def,
    'WHERE sa.user_id = v_trainer_user AND sa.check_in < v_day_end AND COALESCE(sa.check_out, now()) >= v_day_start;',
    'WHERE sa.user_id = v_trainer_user AND sa.check_in >= v_day_start AND sa.check_in < v_day_end;');
  v_def := replace(v_def,
    'SELECT sa.check_in, COALESCE(sa.check_out, LEAST(now(), v_day_end)) FROM public.staff_attendance sa',
    'SELECT sa.check_in, COALESCE(sa.check_out, LEAST(now(), v_day_end, sa.check_in + interval ''14 hours'')) FROM public.staff_attendance sa');
  IF position('sa.check_in >= v_day_start AND sa.check_in < v_day_end;' IN v_def) = 0 THEN RAISE EXCEPTION 'patch failed'; END IF;
  EXECUTE v_def;
END $$;