CREATE OR REPLACE FUNCTION private.mips_dispatch(p_fn text, p_body jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
  v_secret text;
  v_headers jsonb;
BEGIN
  SELECT value INTO v_url FROM private.trigger_config WHERE key = 'supabase_url';
  v_key := private.mips_service_key();
  v_secret := private.mips_webhook_secret();
  IF v_url IS NULL THEN
    RAISE WARNING 'mips_dispatch: missing url, skipping %', p_fn;
    RETURN;
  END IF;

  -- x-internal-token is the authoritative system credential; the stored
  -- service key can go stale after key rotation (caused silent 401s).
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-system-call', 'db-webhook',
    'x-internal-token', public.internal_fn_token()
  );
  IF v_key IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object('apikey', v_key, 'Authorization', 'Bearer ' || v_key);
  END IF;
  IF v_secret IS NOT NULL THEN
    v_headers := v_headers || jsonb_build_object('x-sync-webhook-secret', v_secret);
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/' || p_fn,
    headers := v_headers,
    body := p_body,
    timeout_milliseconds := 8000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'mips_dispatch(%) failed: %', p_fn, SQLERRM;
END;
$$;
REVOKE ALL ON FUNCTION private.mips_dispatch(text, jsonb) FROM PUBLIC, anon, authenticated;