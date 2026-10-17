CREATE OR REPLACE FUNCTION public.voice_outreach_decision(_attempts integer, _last_attempt timestamptz, _stop text, _cooldown integer DEFAULT 7, _now timestamptz DEFAULT now()) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT jsonb_build_object('ok',_stop IS NULL AND coalesce(_attempts,0)<3 AND (_last_attempt IS NULL OR _last_attempt<=_now-make_interval(days=>greatest(coalesce(_cooldown,7),7))),'code',CASE WHEN _stop IS NOT NULL THEN 'outreach_'||_stop WHEN _attempts>=3 THEN 'member_attempt_limit' WHEN _last_attempt>_now-make_interval(days=>greatest(coalesce(_cooldown,7),7)) THEN 'cooldown_active' ELSE NULL END,'attempts',coalesce(_attempts,0),'max_calls',3,'max_followups',2,'cooldown_days',greatest(coalesce(_cooldown,7),7),'next_attempt_at',CASE WHEN _stop IS NULL AND coalesce(_attempts,0)<3 THEN coalesce(_last_attempt+make_interval(days=>greatest(coalesce(_cooldown,7),7)),_now) ELSE NULL END);
$$;
REVOKE ALL ON FUNCTION public.voice_outreach_decision(integer,timestamptz,text,integer,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.voice_outreach_decision(integer,timestamptz,text,integer,timestamptz) TO authenticated,service_role;
DO $p$ DECLARE v text; a int; b int; BEGIN
 v:=pg_get_functiondef('public.voice_member_outreach_check'::regproc);a:=position(' RETURN jsonb_build_object' in v);b:=position('END; $function$' in v);IF a=0 OR b=0 THEN RAISE EXCEPTION 'Unexpected helper definition';END IF;
 v:=substring(v from 1 for a-1)||' RETURN public.voice_outreach_decision(v_count,v_recent,v_stop,v_gap,now());'||chr(10)||substring(v from b);EXECUTE v;
END $p$;
CREATE OR REPLACE FUNCTION public.voice_member_outreach_policy(_member_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_branch uuid;
BEGIN
 SELECT branch_id INTO v_branch FROM public.members WHERE id=_member_id;
 IF public.rpc_guard_applies('voice_member_outreach_policy') AND (auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(),ARRAY['owner','admin','manager','staff']::public.app_role[]) OR NOT EXISTS(SELECT 1 FROM public.user_visible_branch_ids(auth.uid()) b WHERE b=v_branch)) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF v_branch IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;
 RETURN public.voice_member_outreach_check(_member_id,'member_retention',7);
END; $$;
REVOKE ALL ON FUNCTION public.voice_member_outreach_policy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.voice_member_outreach_policy(uuid) TO authenticated,service_role;