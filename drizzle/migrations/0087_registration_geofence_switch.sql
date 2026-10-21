CREATE OR REPLACE FUNCTION public.get_registration_geofence()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN COALESCE((value->>'enabled')::boolean, true) THEN true
      WHEN value->>'disabled_until' IS NOT NULL AND (value->>'disabled_until')::timestamptz <= now() THEN true
      ELSE false END
    FROM public.settings WHERE branch_id IS NULL AND key = 'registration_geofence' LIMIT 1), true)
$$;
REVOKE ALL ON FUNCTION public.get_registration_geofence() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_registration_geofence() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_registration_geofence_detail()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF public.rpc_guard_applies('get_registration_geofence_detail') THEN
    IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager']::text[]) THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT s.value || jsonb_build_object('updated_by_name', p.full_name, 'effective', public.get_registration_geofence())
    INTO v FROM public.settings s LEFT JOIN public.profiles p ON p.id = (s.value->>'updated_by')::uuid
   WHERE s.branch_id IS NULL AND s.key = 'registration_geofence' LIMIT 1;
  RETURN COALESCE(v, jsonb_build_object('enabled', true, 'effective', true));
END $$;
REVOKE ALL ON FUNCTION public.get_registration_geofence_detail() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_registration_geofence_detail() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_registration_geofence(p_enabled boolean, p_disabled_until timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_old jsonb; v_new jsonb;
BEGIN
  IF public.rpc_guard_applies('set_registration_geofence') THEN
    IF NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager']::text[]) THEN
      RAISE EXCEPTION 'Not authorized to change registration location check' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_new := jsonb_build_object('enabled', p_enabled,
    'disabled_until', CASE WHEN p_enabled THEN NULL ELSE p_disabled_until END,
    'updated_by', v_uid, 'updated_at', now());
  SELECT value INTO v_old FROM public.settings WHERE branch_id IS NULL AND key = 'registration_geofence';
  UPDATE public.settings SET value = v_new, updated_at = now() WHERE branch_id IS NULL AND key = 'registration_geofence';
  IF NOT FOUND THEN
    INSERT INTO public.settings (branch_id, key, value) VALUES (NULL, 'registration_geofence', v_new);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, table_name, old_data, new_data, action_description)
  VALUES (v_uid, 'UPDATE', 'settings', v_old, v_new,
    CASE WHEN p_enabled THEN 'Registration location check turned ON' ELSE 'Registration location check turned OFF' END);
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.set_registration_geofence(boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_registration_geofence(boolean, timestamptz) TO authenticated, service_role;