CREATE OR REPLACE FUNCTION public.get_my_duty_presence()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_last record;
  v_scans int := 0;
BEGIN
  SELECT COALESCE(l.captured_at, l.created_at) AS at,
         COALESCE(NULLIF(l.payload->>'deviceName',''), d.device_name, CASE WHEN b.name IS NOT NULL THEN b.name || ' gate' END, 'Gate') AS gate
    INTO v_last
  FROM public.access_logs l
  LEFT JOIN public.access_devices d ON d.serial_number = l.device_sn
  LEFT JOIN public.branches b ON b.id = d.branch_id
  WHERE l.profile_id = auth.uid()
    AND l.device_sn <> 'CRM-SYSTEM'
    AND COALESCE(l.captured_at, l.created_at) >= now() - interval '18 hours'
  ORDER BY COALESCE(l.captured_at, l.created_at) DESC
  LIMIT 1;

  SELECT count(*) INTO v_scans
  FROM public.access_logs l
  WHERE l.profile_id = auth.uid()
    AND l.device_sn <> 'CRM-SYSTEM'
    AND COALESCE(l.captured_at, l.created_at) >= (now() AT TIME ZONE 'Asia/Kolkata')::date AT TIME ZONE 'Asia/Kolkata';

  RETURN jsonb_build_object('last_seen_at', v_last.at, 'gate', v_last.gate, 'scans_today', v_scans);
END;
$function$;