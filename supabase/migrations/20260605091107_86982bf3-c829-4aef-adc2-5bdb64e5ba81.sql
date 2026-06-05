CREATE OR REPLACE FUNCTION public.channel_active_for_branch(p_branch_id uuid, p_channel text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_type text;
  v_found boolean;
BEGIN
  IF p_channel = 'in_app' THEN
    RETURN TRUE;
  END IF;

  v_type := CASE p_channel
    WHEN 'whatsapp' THEN 'whatsapp'
    WHEN 'sms'      THEN 'sms'
    WHEN 'email'    THEN 'email'
    WHEN 'rcs'      THEN 'rcs'
    ELSE NULL
  END;

  IF v_type IS NULL THEN
    RETURN FALSE;
  END IF;

  IF p_branch_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.integration_settings
      WHERE branch_id = p_branch_id
        AND integration_type = v_type
        AND is_active = TRUE
    ) INTO v_found;
    IF v_found THEN RETURN TRUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.integration_settings
      WHERE branch_id = p_branch_id
        AND integration_type = v_type
    ) INTO v_found;
    IF v_found THEN RETURN FALSE; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.integration_settings
    WHERE branch_id IS NULL
      AND integration_type = v_type
      AND is_active = TRUE
  ) INTO v_found;

  RETURN COALESCE(v_found, FALSE);
END;
$function$;