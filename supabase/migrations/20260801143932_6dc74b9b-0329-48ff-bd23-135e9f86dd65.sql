DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'purchase_member_membership'
   LIMIT 1;

  IF v_def IS NULL THEN
    RAISE NOTICE 'purchase_member_membership not found — skipping';
    RETURN;
  END IF;

  v_new := replace(
    v_def,
    'v_end_date := (p_start_date + make_interval(days => GREATEST(COALESCE(v_plan.duration_days, 1) - 1, 0)))::date;',
    'v_end_date := public.membership_end_date(p_start_date, COALESCE(v_plan.duration_days, 1));'
  );

  IF v_new = v_def THEN
    RAISE EXCEPTION 'End-date expression not found in purchase_member_membership — aborting';
  END IF;

  EXECUTE v_new;
END $$;