ALTER TABLE private.dr_config
  ADD COLUMN IF NOT EXISTS standby_url text,
  ADD COLUMN IF NOT EXISTS standby_service_key text,
  ADD COLUMN IF NOT EXISTS standby_db_url text,
  ADD COLUMN IF NOT EXISTS standby_label text,
  ADD COLUMN IF NOT EXISTS standby_app_url text,
  ADD COLUMN IF NOT EXISTS last_test jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

CREATE OR REPLACE FUNCTION public.dr_get_standby_config()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_uid uuid := auth.uid(); c record;
BEGIN
  IF v_uid IS NULL OR NOT public.has_capability(v_uid, 'manage_standby_copy') THEN
    RAISE EXCEPTION 'Only the owner can view standby settings' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM private.dr_config WHERE id = true;
  RETURN jsonb_build_object(
    'standby_url', c.standby_url,
    'standby_label', c.standby_label,
    'standby_app_url', c.standby_app_url,
    'has_service_key', coalesce(length(c.standby_service_key), 0) > 0,
    'service_key_hint', CASE WHEN length(c.standby_service_key) > 8 THEN '••••' || right(c.standby_service_key, 4) END,
    'has_db_url', coalesce(length(c.standby_db_url), 0) > 0,
    'last_test', c.last_test,
    'updated_at', c.updated_at);
END $fn$;
REVOKE ALL ON FUNCTION public.dr_get_standby_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dr_get_standby_config() TO authenticated, service_role;

-- NULL argument = keep current value; empty string = clear.
CREATE OR REPLACE FUNCTION public.dr_save_standby_config(
  p_standby_url text, p_service_key text DEFAULT NULL, p_db_url text DEFAULT NULL,
  p_label text DEFAULT NULL, p_app_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_uid uuid := auth.uid(); v_url text := nullif(btrim(p_standby_url), '');
BEGIN
  IF v_uid IS NULL OR NOT public.has_capability(v_uid, 'manage_standby_copy') THEN
    RAISE EXCEPTION 'Only the owner can change standby settings' USING ERRCODE = '42501';
  END IF;
  IF v_url IS NULL OR v_url !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$' THEN
    RAISE EXCEPTION 'Standby address must be an https:// address' USING ERRCODE = '22023';
  END IF;
  IF p_app_url IS NOT NULL AND btrim(p_app_url) <> '' AND btrim(p_app_url) !~ '^https://' THEN
    RAISE EXCEPTION 'Standby app address must start with https://' USING ERRCODE = '22023';
  END IF;
  IF p_service_key IS NOT NULL AND btrim(p_service_key) <> '' AND length(btrim(p_service_key)) < 30 THEN
    RAISE EXCEPTION 'Standby secret key looks too short' USING ERRCODE = '22023';
  END IF;
  UPDATE private.dr_config SET
    standby_url = rtrim(v_url, '/'),
    standby_service_key = CASE WHEN p_service_key IS NULL THEN standby_service_key ELSE nullif(btrim(p_service_key), '') END,
    standby_db_url = CASE WHEN p_db_url IS NULL THEN standby_db_url ELSE nullif(btrim(p_db_url), '') END,
    standby_label = CASE WHEN p_label IS NULL THEN standby_label ELSE nullif(btrim(p_label), '') END,
    standby_app_url = CASE WHEN p_app_url IS NULL THEN standby_app_url ELSE nullif(rtrim(btrim(p_app_url), '/'), '') END,
    last_test = NULL, updated_at = now(), updated_by = v_uid
  WHERE id = true;
  INSERT INTO public.audit_logs (action, table_name, record_id, new_data, user_id)
  SELECT 'dr_standby_config_updated', 'dr_config', 'standby', jsonb_build_object('standby_url', rtrim(v_url, '/'), 'key_changed', p_service_key IS NOT NULL, 'db_url_changed', p_db_url IS NOT NULL), v_uid
  WHERE to_regclass('public.audit_logs') IS NOT NULL;
  RETURN public.dr_get_standby_config();
EXCEPTION WHEN undefined_column THEN
  RETURN public.dr_get_standby_config();
END $fn$;
REVOKE ALL ON FUNCTION public.dr_save_standby_config(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dr_save_standby_config(text, text, text, text, text) TO authenticated, service_role;