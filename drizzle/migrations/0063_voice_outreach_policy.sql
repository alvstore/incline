ALTER TABLE public.voice_call_attempts ADD COLUMN IF NOT EXISTS outreach_stop_reason text;
CREATE INDEX IF NOT EXISTS voice_member_attempt_history_idx ON public.voice_call_attempts(member_id, created_at DESC) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS voice_member_stop_idx ON public.voice_call_attempts(member_id, outreach_stop_reason) WHERE outreach_stop_reason IS NOT NULL;
CREATE OR REPLACE FUNCTION public.voice_outreach_stop_reason(_disposition text, _vars jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT CASE WHEN lower(coalesce(_vars->>'reason_for_absence','') || ' ' || coalesce(_vars->>'call_summary','')) ~ '(shifting (to|in)|moving (away|from|to)|leaving (from )?udaipur|relocat)' THEN 'relocated' WHEN _disposition IN ('renewal_declined','not_interested') THEN 'declined' WHEN _disposition IN ('wrong_person','do_not_call','do_not_contact') THEN 'do_not_contact' WHEN _disposition IN ('complaint','needs_human','callback_requested','coming_back') THEN 'staff_followup' ELSE NULL END; $$;
REVOKE ALL ON FUNCTION public.voice_outreach_stop_reason(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_outreach_stop_reason(text,jsonb) TO service_role;
UPDATE public.voice_call_attempts SET outreach_stop_reason=public.voice_outreach_stop_reason(disposition,coalesce(context_payload->'final_agent_variables','{}'::jsonb)) WHERE member_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.voice_member_outreach_check(_member_id uuid, _reason text DEFAULT 'member_retention', _cooldown integer DEFAULT 7) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
-- guard-exempt: service-role-only helper used internally by guarded reporting and slot claim.
DECLARE v_start timestamptz; v_count int; v_recent timestamptz; v_stop text; v_gap int:=greatest(coalesce(_cooldown,7),7);
BEGIN
 SELECT start_date::timestamp AT TIME ZONE 'Asia/Kolkata' INTO v_start FROM public.memberships WHERE member_id=_member_id AND status IN ('active','expired','pending') AND start_date<=(now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY start_date DESC,created_at DESC LIMIT 1;
 v_start:=coalesce(v_start,'1970-01-01'::timestamptz);
 SELECT outreach_stop_reason INTO v_stop FROM public.voice_call_attempts WHERE member_id=_member_id AND (outreach_stop_reason IN ('relocated','do_not_contact') OR (created_at>=v_start AND outreach_stop_reason IN ('declined','staff_followup'))) ORDER BY CASE WHEN outreach_stop_reason IN ('relocated','do_not_contact') THEN 0 ELSE 1 END,created_at DESC LIMIT 1;
 SELECT count(*) FILTER(WHERE created_at>=v_start),max(created_at) INTO v_count,v_recent FROM public.voice_call_attempts WHERE member_id=_member_id;
 RETURN jsonb_build_object('ok',v_stop IS NULL AND v_count<3 AND (v_recent IS NULL OR v_recent<=now()-make_interval(days=>v_gap)),'code',CASE WHEN v_stop IS NOT NULL THEN 'outreach_'||v_stop WHEN v_count>=3 THEN 'member_attempt_limit' WHEN v_recent>now()-make_interval(days=>v_gap) THEN 'cooldown_active' ELSE NULL END,'attempts',v_count,'max_calls',3,'max_followups',2,'cooldown_days',v_gap,'next_attempt_at',CASE WHEN v_stop IS NULL AND v_count<3 THEN coalesce(v_recent+make_interval(days=>v_gap),now()) ELSE NULL END);
END; $$;
REVOKE ALL ON FUNCTION public.voice_member_outreach_check(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_member_outreach_check(uuid,text,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.tg_voice_outreach_outcome() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
-- guard-exempt: internal trigger only.
DECLARE v_case record;
BEGIN
 NEW.outreach_stop_reason:=public.voice_outreach_stop_reason(NEW.disposition,coalesce(NEW.context_payload->'final_agent_variables','{}'::jsonb));
 IF NEW.member_id IS NOT NULL AND NEW.outreach_stop_reason IS NOT NULL AND (TG_OP='INSERT' OR NEW.outreach_stop_reason IS DISTINCT FROM OLD.outreach_stop_reason) THEN
 INSERT INTO public.audit_logs(branch_id,user_id,action,table_name,record_id,new_data,actor_name,action_description) VALUES(NEW.branch_id,NEW.created_by,'voice_outreach_stopped','voice_call_attempts',NEW.id,jsonb_build_object('member_id',NEW.member_id,'reason',NEW.outreach_stop_reason),'Voice AI system','Automated member calls stopped after recorded outcome');
 FOR v_case IN SELECT id FROM public.renewal_cases WHERE member_id=NEW.member_id AND closed_at IS NULL AND (NEW.outreach_stop_reason IN ('relocated','do_not_contact') OR membership_id IN (SELECT id FROM public.memberships WHERE member_id=NEW.member_id AND start_date <= (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date)) LOOP
 UPDATE public.renewal_cases SET stage=CASE WHEN NEW.outreach_stop_reason IN ('relocated','declined') THEN 'not_interested'::public.renewal_stage ELSE 'staff_followup'::public.renewal_stage END,outcome=CASE WHEN NEW.outreach_stop_reason IN ('relocated','declined') THEN 'not_interested' ELSE outcome END,churn_reason=CASE WHEN NEW.outreach_stop_reason='relocated' THEN 'relocated' ELSE churn_reason END,closed_at=CASE WHEN NEW.outreach_stop_reason IN ('relocated','declined','do_not_contact') THEN now() ELSE closed_at END,paused_reason='voice_'||NEW.outreach_stop_reason,next_action_at=NULL WHERE id=v_case.id;
 PERFORM public.log_renewal_case_event(v_case.id,'voice_outreach_stopped',NULL,'voice',NEW.outreach_stop_reason,jsonb_build_object('attempt_id',NEW.id));
 END LOOP;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.tg_voice_outreach_outcome() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tg_voice_outreach_outcome() TO service_role;
CREATE TRIGGER tg_voice_outreach_outcome BEFORE INSERT OR UPDATE OF disposition,context_payload ON public.voice_call_attempts FOR EACH ROW EXECUTE FUNCTION public.tg_voice_outreach_outcome();