CREATE OR REPLACE FUNCTION public.log_mobile_error(
  p_message text, p_severity text DEFAULT 'error', p_screen text DEFAULT NULL,
  p_stack text DEFAULT NULL, p_app_version text DEFAULT NULL, p_platform text DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL, p_context jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_message IS NULL OR btrim(p_message) = '' THEN RETURN NULL; END IF;
  IF p_message ILIKE '%SocketException%' OR p_message ILIKE '%Failed host lookup%'
     OR p_message ILIKE '%Connection timed out%' OR p_message ILIKE '%Network is unreachable%'
     OR p_message ILIKE '%Connection closed%' OR p_message ILIKE '%ClientException%' THEN
    RETURN NULL;
  END IF;
  RETURN public.log_error_event(
    CASE WHEN p_severity IN ('info','warning','error','critical') THEN p_severity ELSE 'error' END,
    'mobile_app', left(p_message, 2000), NULL, left(p_screen, 200), NULL, p_branch_id, auth.uid(),
    NULL, left(p_app_version, 50), left(p_stack, 8000),
    jsonb_build_object('platform', left(p_platform, 20), 'app_version', left(p_app_version, 50))
      || CASE WHEN p_context IS NOT NULL AND length(p_context::text) <= 4000 THEN p_context ELSE '{}'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.log_mobile_error(text,text,text,text,text,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_mobile_error(text,text,text,text,text,text,uuid,jsonb) TO authenticated;