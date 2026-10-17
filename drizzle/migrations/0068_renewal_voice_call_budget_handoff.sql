-- Cost guard: once a renewal case has used its 3-call voice budget, stop
-- looping it back into the Voice AI queue and hand it to staff instead.

CREATE OR REPLACE FUNCTION public.tg_voice_sync_renewal_case()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_stage public.renewal_stage; v_event text; v_attempts integer;
BEGIN
 IF NEW.renewal_case_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.disposition IS DISTINCT FROM OLD.disposition THEN
   v_event := 'voice_'||COALESCE(NULLIF(NEW.disposition,''),NEW.status,'updated');
   SELECT voice_attempts_count + CASE WHEN TG_OP='INSERT' THEN 1 ELSE 0 END
     INTO v_attempts FROM public.renewal_cases WHERE id=NEW.renewal_case_id;
   v_attempts := COALESCE(v_attempts, 0);
   v_stage := CASE
     WHEN NEW.disposition='callback_requested' THEN 'callback'::public.renewal_stage
     WHEN NEW.disposition IN('renewal_declined','not_interested','wrong_person') THEN 'not_interested'::public.renewal_stage
     WHEN NEW.disposition='coming_back' THEN 'staff_followup'::public.renewal_stage
     -- Budget exhausted: hand off to staff instead of re-queuing for another paid call.
     WHEN v_attempts >= 3 THEN 'staff_followup'::public.renewal_stage
     ELSE 'voice_escalation'::public.renewal_stage END;
   UPDATE public.renewal_cases SET stage=v_stage,
     voice_attempts_count=voice_attempts_count+CASE WHEN TG_OP='INSERT' THEN 1 ELSE 0 END,
     next_action_at=CASE
       WHEN NEW.disposition='callback_requested' THEN COALESCE((NEW.context_payload->>'callback_datetime')::timestamptz,now()+interval '7 days')
       WHEN v_stage='staff_followup' AND NEW.disposition IS DISTINCT FROM 'coming_back' THEN now()
       ELSE next_action_at END,
     outcome=CASE WHEN NEW.disposition='not_interested' THEN 'not_interested' ELSE outcome END,
     updated_at=now() WHERE id=NEW.renewal_case_id AND closed_at IS NULL;
   INSERT INTO public.renewal_case_events(case_id,branch_id,event_type,stage,channel,detail,payload)
   SELECT rc.id,rc.branch_id,v_event,v_stage,'voice',NEW.error_message,
     jsonb_build_object('call_id',NEW.id,'status',NEW.status,'disposition',NEW.disposition)
   FROM public.renewal_cases rc WHERE rc.id=NEW.renewal_case_id;
   -- Audit the handoff so staff can see why automatic calling stopped.
   IF v_stage='staff_followup' AND v_attempts>=3 AND NEW.disposition NOT IN ('coming_back','callback_requested') THEN
     INSERT INTO public.renewal_case_events(case_id,branch_id,event_type,stage,channel,detail,payload)
     SELECT rc.id,rc.branch_id,'voice_attempts_exhausted','staff_followup','voice',
       'Voice call budget used (3 calls). Automatic calling stopped; staff follow-up required.',
       jsonb_build_object('call_id',NEW.id,'attempts',v_attempts)
     FROM public.renewal_cases rc WHERE rc.id=NEW.renewal_case_id AND rc.closed_at IS NULL;
   END IF;
 END IF;
 RETURN NEW;
END; $function$;

-- Block staff from re-queuing a case for AI calls once the budget is spent or
-- outreach is suppressed (declined / relocated / do-not-contact / cooldown).
CREATE OR REPLACE FUNCTION public.renewal_case_action(_case_id uuid, _action text, _snoozed_until timestamp with time zone DEFAULT NULL::timestamp with time zone, _outcome text DEFAULT NULL::text, _churn_reason text DEFAULT NULL::text, _note text DEFAULT NULL::text, _assignee uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_case public.renewal_cases%ROWTYPE; v_stage public.renewal_stage; v_close boolean := false; v_check jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_manage_renewal_case(_case_id) THEN
    RAISE EXCEPTION 'Not authorized to manage this renewal case';
  END IF;
  SELECT * INTO v_case FROM public.renewal_cases WHERE id=_case_id FOR UPDATE;
  IF v_case.id IS NULL THEN RAISE EXCEPTION 'Renewal case not found'; END IF;

  CASE _action
    WHEN 'claim' THEN
      UPDATE public.renewal_cases SET claimed_by=COALESCE(_assignee,auth.uid()),claimed_at=now(),paused_reason='staff_handling' WHERE id=_case_id;
      PERFORM public.log_renewal_case_event(_case_id,'claimed',v_case.stage,NULL,_note,jsonb_build_object('assignee',COALESCE(_assignee,auth.uid())));
    WHEN 'unclaim' THEN
      UPDATE public.renewal_cases SET claimed_by=NULL,claimed_at=NULL,paused_reason=NULL WHERE id=_case_id;
      PERFORM public.log_renewal_case_event(_case_id,'unclaimed',v_case.stage,NULL,_note,'{}'::jsonb);
    WHEN 'snooze' THEN
      IF _snoozed_until IS NULL OR _snoozed_until <= now() THEN RAISE EXCEPTION 'Choose a future follow-up time'; END IF;
      UPDATE public.renewal_cases SET snoozed_until=_snoozed_until,next_action_at=_snoozed_until,stage='callback',claimed_by=COALESCE(claimed_by,auth.uid()),claimed_at=COALESCE(claimed_at,now()),paused_reason='staff_handling' WHERE id=_case_id;
      PERFORM public.log_renewal_case_event(_case_id,'callback_scheduled','callback',NULL,_note,jsonb_build_object('at',_snoozed_until));
    WHEN 'voice_escalate' THEN
      IF v_case.voice_attempts_count >= 3 THEN
        RAISE EXCEPTION 'Voice call limit reached (3 calls this cycle). Follow up in person or record an outcome instead.';
      END IF;
      v_check := public.voice_member_outreach_check(v_case.member_id,'member_renewal',7);
      IF COALESCE((v_check->>'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Voice AI cannot call this member right now (%).', COALESCE(v_check->>'code','not_eligible');
      END IF;
      UPDATE public.renewal_cases SET stage='voice_escalation',next_action_at=now(),paused_reason=NULL WHERE id=_case_id AND closed_at IS NULL;
      PERFORM public.log_renewal_case_event(_case_id,'voice_requested','voice_escalation','voice',_note,'{}'::jsonb);
    WHEN 'manual_contact' THEN
      UPDATE public.renewal_cases SET last_contact_at=now(),attempts_count=attempts_count+1,stage='staff_followup',claimed_by=COALESCE(claimed_by,auth.uid()),claimed_at=COALESCE(claimed_at,now()),paused_reason='staff_handling' WHERE id=_case_id AND closed_at IS NULL;
      PERFORM public.log_renewal_case_event(_case_id,'staff_contacted','staff_followup','manual',_note,'{}'::jsonb);
    WHEN 'outcome' THEN
      IF _outcome NOT IN ('renewed','callback','staff_followup','not_interested','frozen','cancelled','churned','win_back') THEN
        RAISE EXCEPTION 'Unsupported renewal outcome';
      END IF;
      v_stage := _outcome::public.renewal_stage;
      v_close := _outcome IN ('renewed','not_interested','cancelled','churned','win_back');
      IF _outcome='renewed' AND public.renewal_payment_evidence(COALESCE(v_case.candidate_membership_id,v_case.renewed_membership_id)) IS NULL THEN
        RAISE EXCEPTION 'Paid or complimentary renewal evidence is required';
      END IF;
      UPDATE public.renewal_cases SET stage=v_stage,outcome=_outcome,churn_reason=NULLIF(btrim(_churn_reason),''),
        next_action_at=CASE WHEN v_close THEN NULL ELSE COALESCE(_snoozed_until,next_action_at) END,
        snoozed_until=CASE WHEN _outcome='callback' THEN _snoozed_until ELSE snoozed_until END,
        closed_at=CASE WHEN v_close THEN now() ELSE NULL END,
        paused_reason=CASE WHEN v_close THEN NULL ELSE 'staff_handling' END,
        claimed_by=COALESCE(claimed_by,auth.uid()),claimed_at=COALESCE(claimed_at,now()) WHERE id=_case_id;
      PERFORM public.log_renewal_case_event(_case_id,'outcome_recorded',v_stage,NULL,_note,jsonb_build_object('outcome',_outcome,'churn_reason',_churn_reason));
    ELSE RAISE EXCEPTION 'Unsupported renewal action';
  END CASE;
  RETURN jsonb_build_object('success',true,'case_id',_case_id,'action',_action);
END; $function$;