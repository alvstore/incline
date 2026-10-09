CREATE OR REPLACE FUNCTION public.voice_automation_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_last jsonb; v_rule jsonb; v_switch jsonb; v_call timestamptz; v_renewal jsonb;
BEGIN
 IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::public.app_role[]) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT to_jsonb(r) INTO v_last FROM (SELECT id,status,started_at,finished_at,candidates_found,calls_attempted,calls_placed,calls_skipped,error_count,last_error,skip_reason FROM public.voice_automation_runs ORDER BY started_at DESC LIMIT 1) r;
 SELECT to_jsonb(r) INTO v_rule FROM (SELECT key,is_active,cron_expression,last_run_at,next_run_at,last_status,last_error FROM public.automation_rules WHERE key='voice_retention_worker' LIMIT 1) r;
 SELECT jsonb_build_object('enabled',coalesce((retention_automation->>'enabled')::boolean,false),'paused',coalesce((retention_automation->>'paused')::boolean,false),'pause_reason',retention_automation->>'pause_reason','is_active',is_active,'window_start',coalesce(retention_automation->>'window_start','10:00'),'window_end',coalesce(retention_automation->>'window_end','19:00')) INTO v_switch FROM public.voice_provider_integrations WHERE provider='sarvam' AND branch_id IS NULL LIMIT 1;
 SELECT max(coalesce(started_at,created_at)) INTO v_call FROM public.voice_call_attempts WHERE provider='sarvam' AND provider_call_id IS NOT NULL AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()));
 SELECT jsonb_build_object('enabled',coalesce(c.enabled,false),'voice_enabled',coalesce(c.voice_auto_call_enabled,false),'paused',coalesce(s.paused,false),'pause_reason',s.paused_reason,'next_check_at',r.next_run_at,'last_check_at',r.last_run_at) INTO v_renewal FROM public.renewal_engine_config c LEFT JOIN public.renewal_engine_state s ON s.id='global' LEFT JOIN public.automation_rules r ON r.key='renewal_engine_tick' WHERE c.branch_id IS NULL LIMIT 1;
 RETURN jsonb_build_object('last_run',v_last,'scheduler',v_rule,'automation',v_switch,'last_call_at',v_call,'renewal',v_renewal,'now_ist',to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD"T"HH24:MI:SS'));
END; $$;
REVOKE ALL ON FUNCTION public.voice_automation_health() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.voice_automation_health() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.renewal_voice_due_cases(_limit integer DEFAULT 50)
RETURNS TABLE(case_id uuid,branch_id uuid,member_id uuid,membership_id uuid,days_to_expiry integer,phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 -- guard-exempt: internal worker only; EXECUTE revoked from client roles below.
 SELECT rc.id,rc.branch_id,rc.member_id,rc.membership_id,(rc.expiry_date-(now() AT TIME ZONE 'Asia/Kolkata')::date)::integer,p.phone
 FROM public.renewal_cases rc JOIN public.members m ON m.id=rc.member_id JOIN public.profiles p ON p.id=m.user_id
 JOIN LATERAL (SELECT c.* FROM public.renewal_engine_config c WHERE c.branch_id=rc.branch_id OR c.branch_id IS NULL ORDER BY c.branch_id NULLS LAST LIMIT 1) cfg ON true
 WHERE rc.closed_at IS NULL AND cfg.enabled AND cfg.voice_auto_call_enabled
 AND rc.stage IN ('eligible','reminding','lapsed','win_back','voice_escalation')
 AND (rc.snoozed_until IS NULL OR rc.snoozed_until<=now())
 AND (rc.next_action_at IS NULL OR rc.next_action_at<=now())
 AND rc.voice_attempts_count<3 AND NOT coalesce(m.do_not_contact,false) AND m.status<>'blacklisted' AND p.phone IS NOT NULL
 AND (rc.stage='voice_escalation' OR ((now() AT TIME ZONE 'Asia/Kolkata')::date-rc.expiry_date)=ANY(cfg.voice_stage_offsets))
 AND NOT EXISTS (SELECT 1 FROM public.voice_call_attempts v WHERE v.renewal_case_id=rc.id AND (v.status IN ('initiated','queued','in_progress','connected','completed') OR coalesce(v.started_at,v.created_at)>now()-interval '3 days'))
 ORDER BY rc.next_action_at ASC NULLS FIRST,rc.expiry_date LIMIT least(greatest(coalesce(_limit,50),0),50);
$$;
REVOKE ALL ON FUNCTION public.renewal_voice_due_cases(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_voice_due_cases(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.renewal_link_voice_call(_case_id uuid,_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_case public.renewal_cases%ROWTYPE; v_attempt public.voice_call_attempts%ROWTYPE;
BEGIN
 IF public.rpc_guard_applies('renewal_link_voice_call') AND NOT public.can_manage_renewal_case(_case_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_case FROM public.renewal_cases WHERE id=_case_id FOR UPDATE;
 IF NOT FOUND OR v_case.closed_at IS NOT NULL THEN RAISE EXCEPTION 'Renewal case not open'; END IF;
 SELECT * INTO v_attempt FROM public.voice_call_attempts WHERE id=_attempt_id FOR UPDATE;
 IF NOT FOUND OR v_attempt.member_id IS DISTINCT FROM v_case.member_id OR v_attempt.branch_id IS DISTINCT FROM v_case.branch_id OR v_attempt.provider_call_id IS NULL THEN RAISE EXCEPTION 'Call does not match renewal case'; END IF;
 IF v_attempt.renewal_case_id=_case_id THEN RETURN jsonb_build_object('ok',true,'idempotent',true); END IF;
 IF v_attempt.renewal_case_id IS NOT NULL THEN RAISE EXCEPTION 'Call already linked'; END IF;
 UPDATE public.voice_call_attempts SET renewal_case_id=_case_id WHERE id=_attempt_id;
 UPDATE public.renewal_cases SET stage='voice_escalation',voice_attempts_count=voice_attempts_count+1,last_contact_at=now(),next_action_at=now()+interval '3 days',paused_reason=NULL WHERE id=_case_id;
 PERFORM public.log_renewal_case_event(_case_id,'voice_call_placed','voice_escalation'::public.renewal_stage,'voice',NULL,jsonb_build_object('attempt_id',_attempt_id));
 RETURN jsonb_build_object('ok',true);
END; $$;
REVOKE ALL ON FUNCTION public.renewal_link_voice_call(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renewal_link_voice_call(uuid,uuid) TO authenticated,service_role;