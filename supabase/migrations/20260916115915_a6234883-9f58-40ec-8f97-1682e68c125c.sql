-- Renewal Center <-> Voice AI bridge (no new edge functions)

CREATE OR REPLACE FUNCTION public.renewal_link_voice_call(_case_id uuid, _attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case public.renewal_cases%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_renewal_case(_case_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this renewal case';
  END IF;
  SELECT * INTO v_case FROM public.renewal_cases WHERE id = _case_id FOR UPDATE;
  IF v_case.id IS NULL THEN RAISE EXCEPTION 'Renewal case not found'; END IF;

  UPDATE public.voice_call_attempts
     SET renewal_case_id = _case_id
   WHERE id = _attempt_id
     AND (renewal_case_id IS NULL OR renewal_case_id = _case_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Voice call attempt not found'; END IF;

  UPDATE public.renewal_cases
     SET stage = 'voice_escalation',
         voice_attempts_count = voice_attempts_count + 1,
         last_contact_at = now(),
         next_action_at = now(),
         paused_reason = NULL
   WHERE id = _case_id AND closed_at IS NULL;

  PERFORM public.log_renewal_case_event(
    _case_id, 'voice_call_placed', 'voice_escalation'::public.renewal_stage, 'voice', NULL,
    jsonb_build_object('attempt_id', _attempt_id)
  );
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE EXECUTE ON FUNCTION public.renewal_link_voice_call(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renewal_link_voice_call(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.renewal_case_voice_calls(_case_id uuid)
RETURNS TABLE (
  call_id uuid, started_at timestamptz, ended_at timestamptz, status text,
  disposition text, duration_seconds integer, call_summary text,
  next_step_agreed text, callback_datetime text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_renewal_case(_case_id) THEN
    RAISE EXCEPTION 'Not authorized to view this renewal case';
  END IF;
  RETURN QUERY
  SELECT v.id, v.started_at, v.ended_at, v.status::text, v.disposition::text,
         v.duration_seconds,
         NULLIF(v.context_payload->'final_agent_variables'->>'call_summary',''),
         NULLIF(v.context_payload->'final_agent_variables'->>'next_step_agreed',''),
         NULLIF(v.context_payload->'final_agent_variables'->>'callback_datetime','')
  FROM public.voice_call_attempts v
  WHERE v.renewal_case_id = _case_id
  ORDER BY v.started_at DESC NULLS LAST
  LIMIT 20;
END; $$;
REVOKE EXECUTE ON FUNCTION public.renewal_case_voice_calls(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renewal_case_voice_calls(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_renewal_voice_outcome()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stage public.renewal_stage;
  v_next timestamptz;
  v_vars jsonb := COALESCE(NEW.context_payload->'final_agent_variables', '{}'::jsonb);
  v_cb text := NULLIF(v_vars->>'callback_datetime','');
BEGIN
  IF NEW.renewal_case_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.disposition IS NULL OR NEW.disposition IS NOT DISTINCT FROM OLD.disposition THEN RETURN NEW; END IF;

  v_stage := CASE NEW.disposition
    WHEN 'callback_requested' THEN 'callback'::public.renewal_stage
    WHEN 'not_interested'     THEN 'staff_followup'::public.renewal_stage
    WHEN 'complaint'          THEN 'staff_followup'::public.renewal_stage
    WHEN 'needs_human'        THEN 'staff_followup'::public.renewal_stage
    WHEN 'coming_back'        THEN 'staff_followup'::public.renewal_stage
    ELSE NULL END;

  BEGIN
    v_next := CASE WHEN v_cb IS NOT NULL THEN v_cb::timestamptz ELSE NULL END;
  EXCEPTION WHEN others THEN v_next := NULL;
  END;

  UPDATE public.renewal_cases
     SET stage = COALESCE(v_stage, stage),
         last_contact_at = now(),
         attempts_count = attempts_count + 1,
         snoozed_until = COALESCE(v_next, snoozed_until),
         next_action_at = COALESCE(v_next, now() + interval '1 day')
   WHERE id = NEW.renewal_case_id AND closed_at IS NULL;

  PERFORM public.log_renewal_case_event(
    NEW.renewal_case_id, 'voice_outcome', COALESCE(v_stage, 'voice_escalation'::public.renewal_stage), 'voice',
    NULLIF(v_vars->>'call_summary',''),
    jsonb_build_object('attempt_id', NEW.id, 'disposition', NEW.disposition, 'status', NEW.status)
  );
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.tg_renewal_voice_outcome() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_renewal_voice_outcome ON public.voice_call_attempts;
CREATE TRIGGER trg_renewal_voice_outcome
AFTER UPDATE ON public.voice_call_attempts
FOR EACH ROW EXECUTE FUNCTION public.tg_renewal_voice_outcome();