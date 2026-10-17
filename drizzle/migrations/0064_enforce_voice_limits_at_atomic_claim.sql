DO $patch$
DECLARE v text;
BEGIN
 v:=pg_get_functiondef('public.voice_claim_call_slot'::regproc);
 IF position('v_id uuid;' in v)=0 THEN RAISE EXCEPTION 'Unexpected claim definition'; END IF;
 v:=replace(v,'v_id uuid;','v_id uuid; v_guard jsonb;');
 v:=replace(v,'  SELECT count(*) INTO v_today',E'  IF _member_id IS NOT NULL THEN\n    v_guard:=public.voice_member_outreach_check(_member_id,_reason,_cooldown_days);\n    IF NOT (v_guard->>''ok'')::boolean THEN RETURN jsonb_build_object(''ok'',false,''error_code'',v_guard->>''code'',''error'',''Member outreach stopped or follow-up limit reached.'',''policy'',v_guard); END IF;\n  END IF;\n  SELECT count(*) INTO v_today');
 v:=replace(v,$a$status IN ('queued', 'initiated', 'ringing')$a$,$b$status IN ('queued', 'initiated', 'ringing', 'answered', 'in_progress')$b$);
 EXECUTE v;
 v:=pg_get_functiondef('public.voice_retention_candidates'::regproc);
 IF position('  FROM cycle;' in v)=0 THEN RAISE EXCEPTION 'Unexpected candidates definition'; END IF;
 v:=replace(v,'    paused,',E'    paused OR coalesce((guard->>''code'') IN (''outreach_relocated'',''outreach_declined'',''outreach_do_not_contact'',''outreach_staff_followup''),false),');
 v:=replace(v,'    END AS in_cooldown,',E'    END OR coalesce((guard->>''code''=''cooldown_active''),false) AS in_cooldown,');
 v:=replace(v,'(attempts_today >= greatest(_max_attempts, 1)) AS contacted_today','(attempts_today >= 1) AS contacted_today');
 v:=replace(v,'    attempts_cycle::integer,',E'    (guard->>''attempts'')::integer,');
 v:=replace(v,'(last_reached_at IS NULL AND attempts_cycle >= greatest(_max_attempts, 1)) AS attempts_exhausted',E'((guard->>''attempts'')::integer >= least(greatest(_max_attempts,1),3)) AS attempts_exhausted');
 v:=replace(v,'    CASE' || chr(10) || '      WHEN last_reached_at IS NOT NULL' || chr(10) || '        THEN',E'    CASE\n      WHEN NOT (guard->>''ok'')::boolean AND guard->>''code'' <> ''cooldown_active'' THEN NULL\n      WHEN (guard->>''next_attempt_at'')::timestamptz > now() THEN (guard->>''next_attempt_at'')::timestamptz\n      WHEN last_reached_at IS NOT NULL\n        THEN');
 v:=replace(v,'  FROM cycle;',E'  FROM cycle CROSS JOIN LATERAL (SELECT public.voice_member_outreach_check(id,''member_retention'',greatest(_cooldown_days,7)) AS guard) policy;');
 EXECUTE v;
 v:=pg_get_functiondef('public.renewal_voice_due_cases'::regproc);
 IF position('WHERE rc.closed_at IS NULL' in v)=0 THEN RAISE EXCEPTION 'Unexpected renewal selection'; END IF;
 v:=replace(v,'WHERE rc.closed_at IS NULL',E'WHERE (public.voice_member_outreach_check(rc.member_id,''member_renewal'',7)->>''ok'')::boolean AND rc.claimed_by IS NULL AND rc.closed_at IS NULL');
 EXECUTE v;
END $patch$;
REVOKE ALL ON FUNCTION public.voice_claim_call_slot(text,uuid,text,text,text,uuid,uuid,text,integer,integer,integer,integer,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voice_claim_call_slot(text,uuid,text,text,text,uuid,uuid,text,integer,integer,integer,integer,jsonb,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.renewal_voice_due_cases(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.renewal_voice_due_cases(integer) TO service_role;