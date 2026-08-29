CREATE OR REPLACE FUNCTION public.log_error_event(p_severity text, p_source text, p_message text, p_function_name text DEFAULT NULL::text, p_route text DEFAULT NULL::text, p_table_name text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_request_id text DEFAULT NULL::text, p_release_sha text DEFAULT NULL::text, p_stack text DEFAULT NULL::text, p_context jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fp text;
  v_id uuid;
BEGIN
  -- Client-side connectivity noise is never an app bug: drop it at the door.
  IF p_source IN ('frontend', 'client') AND (
       p_message ILIKE 'Network error - check your internet connection%'
    OR p_message ILIKE '%Failed to fetch%'
    OR p_message ILIKE '%NetworkError%'
    OR p_message ILIKE '%Network request failed%'
    OR p_message = 'Load failed'
  ) THEN
    RETURN NULL;
  END IF;

  v_fp := public.compute_error_fingerprint(p_severity, p_source, p_function_name, p_route, p_message);

  INSERT INTO public.error_logs (
    severity, source, error_message, stack_trace, route, function_name, table_name,
    branch_id, user_id, request_id, release_sha, context, status,
    fingerprint, occurrence_count, first_seen, last_seen
  )
  VALUES (
    coalesce(nullif(p_severity, ''), 'error'),
    coalesce(nullif(p_source, ''), 'unknown'),
    left(coalesce(p_message, '(no message)'), 2000),
    left(p_stack, 8000),
    p_route, p_function_name, p_table_name,
    p_branch_id, p_user_id, p_request_id, p_release_sha, p_context,
    'open', v_fp, 1, now(), now()
  )
  ON CONFLICT (fingerprint) WHERE (status = 'open' AND fingerprint IS NOT NULL)
  DO UPDATE SET
    occurrence_count = public.error_logs.occurrence_count + 1,
    last_seen = now(),
    context = COALESCE(EXCLUDED.context, public.error_logs.context)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

UPDATE public.error_logs
SET status = 'resolved', resolved_at = now()
WHERE status = 'open'
  AND source IN ('frontend', 'client')
  AND (
    error_message ILIKE 'Network error - check your internet connection%'
    OR error_message ILIKE '%Failed to fetch%'
    OR error_message ILIKE '%NetworkError%'
    OR error_message = 'Load failed'
  );