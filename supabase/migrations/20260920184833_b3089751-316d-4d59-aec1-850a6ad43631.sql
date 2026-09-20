DROP FUNCTION IF EXISTS public.renewal_case_voice_calls(uuid);

CREATE FUNCTION public.renewal_case_voice_calls(_case_id uuid)
RETURNS TABLE (
  call_id uuid, started_at timestamptz, ended_at timestamptz, status text,
  disposition text, duration_seconds integer, call_summary text,
  next_step_agreed text, callback_datetime text, error_message text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_renewal_case(_case_id) THEN
    RAISE EXCEPTION 'Not authorized to view this renewal case';
  END IF;
  RETURN QUERY
  SELECT v.id,
         v.started_at,
         v.ended_at,
         v.status::text,
         v.disposition::text,
         -- duration_seconds is numeric in voice_call_attempts; the previous
         -- definition declared integer here and Postgres aborted the whole
         -- call with 42804 "structure of query does not match function result
         -- type". Round + cast explicitly so the shapes always agree.
         CASE WHEN v.duration_seconds IS NULL THEN NULL
              ELSE ROUND(v.duration_seconds)::integer END,
         NULLIF(v.context_payload->'final_agent_variables'->>'call_summary',''),
         NULLIF(v.context_payload->'final_agent_variables'->>'next_step_agreed',''),
         NULLIF(v.context_payload->'final_agent_variables'->>'callback_datetime',''),
         NULLIF(v.error_message,'')
  FROM public.voice_call_attempts v
  WHERE v.renewal_case_id = _case_id
  ORDER BY v.started_at DESC NULLS LAST
  LIMIT 20;
END; $$;

REVOKE EXECUTE ON FUNCTION public.renewal_case_voice_calls(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renewal_case_voice_calls(uuid) TO authenticated, service_role;