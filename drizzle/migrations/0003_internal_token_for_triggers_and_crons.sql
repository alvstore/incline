DO $do$
DECLARE r record; d text; j record; c text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
    AND p.proname IN ('tg_ai_knowledge_enqueue_embed','_notify_booking_event','fn_notify_lead_created','tg_members_after_insert_provision_login')
  LOOP
    d := pg_get_functiondef(r.oid);
    IF position('x-internal-token' in d) > 0 THEN CONTINUE; END IF;
    d := replace(d, '''Content-Type'', ''application/json''', '''Content-Type'', ''application/json'', ''x-internal-token'', public.internal_fn_token()');
    d := replace(d, '''Content-Type'',''application/json''', '''Content-Type'',''application/json'',''x-internal-token'',public.internal_fn_token()');
    EXECUTE d;
  END LOOP;

  FOR j IN SELECT jobid, command FROM cron.job WHERE command LIKE '%functions/v1/%' AND command NOT LIKE '%x-internal-token%'
      AND command NOT LIKE '%dr-replicate%' LOOP
    c := j.command;
    IF c LIKE '%''{"Content-Type":"application/json"%''::jsonb%' THEN
      c := regexp_replace(c, '(''\{"Content-Type":"application/json"[^'']*\}''::jsonb)', '(\1 || jsonb_build_object(''x-internal-token'', public.internal_fn_token()))');
    ELSE
      c := replace(c, '''Content-Type'', ''application/json''', '''Content-Type'', ''application/json'', ''x-internal-token'', public.internal_fn_token()');
      c := replace(c, '''Content-Type'',''application/json''', '''Content-Type'',''application/json'',''x-internal-token'',public.internal_fn_token()');
    END IF;
    PERFORM cron.alter_job(job_id := j.jobid, command := c);
  END LOOP;
END $do$;