DO $do$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname='create_pos_sale_audited' AND pronamespace='public'::regnamespace;
  v_def := replace(v_def,
    'INSERT INTO public.salary_advances (branch_id, user_id, amount, outstanding, payment_method, payment_reference, reason, auto_recover, created_by)',
    'INSERT INTO public.salary_advances (source, branch_id, user_id, amount, outstanding, payment_method, payment_reference, reason, auto_recover, created_by)');
  v_def := replace(v_def, 'VALUES (p_branch_id, p_staff_user_id, (v_res->>''total'')::numeric', 'VALUES (''pos'', p_branch_id, p_staff_user_id, (v_res->>''total'')::numeric');
  IF strpos(v_def, '''pos'', p_branch_id, p_staff_user_id') = 0 THEN RAISE EXCEPTION 'patch point not found'; END IF;
  EXECUTE v_def;
END $do$;
UPDATE public.salary_advances SET source = 'pos' WHERE reason LIKE 'Store purchase – %' AND source = 'manual';