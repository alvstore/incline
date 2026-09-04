DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='record_benefit_usage'
  LIMIT 1;
  IF d IS NULL THEN RAISE EXCEPTION 'record_benefit_usage not found'; END IF;
  d := replace(d, 'v_sources := v_sources || ''plan''', 'v_sources := array_append(v_sources, ''plan''::text)');
  d := replace(d, 'v_sources := v_sources || ''gift''', 'v_sources := array_append(v_sources, ''gift''::text)');
  d := replace(d, 'v_sources := v_sources || ''purchased''', 'v_sources := array_append(v_sources, ''purchased''::text)');
  EXECUTE d;
END
$mig$;