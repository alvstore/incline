DO $migration$ DECLARE fn regprocedure; def text; BEGIN
 FOREACH fn IN ARRAY ARRAY['public.calculate_upgrade_cost(uuid)'::regprocedure,'public.convert_to_annual(uuid,uuid)'::regprocedure,'public.create_upgrade_invoice(uuid)'::regprocedure] LOOP
  def := pg_get_functiondef(fn); def := replace(def, 'v_offer.window_ends_at < now()', 'v_offer.window_ends_at <= now()'); EXECUTE def;
 END LOOP;
 def := pg_get_functiondef('public.upgrade_analytics_summary(uuid,integer)'::regprocedure);
 def := replace(def, 'WHERE dedupe_key=''upgrade:''||o.id::text||'':''||s.stage||'':wa''', 'WHERE (dedupe_key=''upgrade:''||o.id::text||'':''||s.stage||'':wa'' OR (delivery_metadata->''variables''->>''upgrade_offer_id''=o.id::text AND delivery_metadata->''variables''->>''event_key''=CASE WHEN s.stage=''d7'' THEN ''annual_upgrade_day7'' ELSE ''annual_upgrade_closing'' END))');
 EXECUTE def;
END $migration$;
GRANT EXECUTE ON FUNCTION public.calculate_upgrade_cost(uuid), public.convert_to_annual(uuid,uuid) TO authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.create_upgrade_invoice(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_upgrade_invoice(uuid) TO service_role;