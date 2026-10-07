DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_pos_sale';
  d := replace(d, $r$NULLIF(e->>'product_id','')
$r$, $r$NULLIF(e->>'product_id','')::uuid
$r$);
  EXECUTE d;
END $mig$;