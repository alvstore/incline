CREATE OR REPLACE FUNCTION private.run_web_push()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'private', 'public', 'extensions'
AS $function$ DECLARE v_url text; v_key text; v_tok text; BEGIN
  SELECT value INTO v_url FROM private.trigger_config WHERE key='supabase_url';
  v_key := private.mips_service_key();
  SELECT token INTO v_tok FROM private.internal_fn_config WHERE id = true;
  IF v_url IS NOT NULL AND (v_key IS NOT NULL OR v_tok IS NOT NULL) THEN
    PERFORM net.http_post(url:=v_url||'/functions/v1/web-push',
      headers:=jsonb_strip_nulls(jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||coalesce(v_key,''),'apikey',v_key,'x-internal-token',v_tok)),
      body:='{"action":"deliver"}'::jsonb, timeout_milliseconds:=10000);
  END IF; END $function$;
REVOKE EXECUTE ON FUNCTION private.run_web_push() FROM PUBLIC, anon, authenticated;