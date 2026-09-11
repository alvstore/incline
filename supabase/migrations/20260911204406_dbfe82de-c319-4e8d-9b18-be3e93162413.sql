-- Renewal Center + HOWBODY recovery hardening

INSERT INTO public.role_capabilities(role, capability) VALUES
  ('owner'::public.app_role, 'manage_renewals'),
  ('admin'::public.app_role, 'manage_renewals'),
  ('manager'::public.app_role, 'manage_renewals'),
  ('staff'::public.app_role, 'manage_renewals')
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS renewal_cases_queue_idx
  ON public.renewal_cases (branch_id, stage, next_action_at, expiry_date)
  WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS renewal_cases_claimed_idx
  ON public.renewal_cases (claimed_by, claimed_at)
  WHERE closed_at IS NULL AND claimed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS renewal_events_outcome_idx
  ON public.renewal_case_events (branch_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS howbody_body_scan_member_idx
  ON public.howbody_body_reports (scan_id, member_id) WHERE scan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS howbody_posture_scan_member_idx
  ON public.howbody_posture_reports (scan_id, member_id) WHERE scan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS howbody_sessions_recovery_idx
  ON public.howbody_scan_sessions (member_id, status, created_at DESC);

ALTER TABLE public.voice_call_attempts
  ADD COLUMN IF NOT EXISTS renewal_case_id uuid REFERENCES public.renewal_cases(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS voice_call_attempts_renewal_case_idx
  ON public.voice_call_attempts (renewal_case_id, started_at DESC)
  WHERE renewal_case_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_manage_renewal_case(_case_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.renewal_cases rc
    WHERE rc.id = _case_id
      AND public.has_capability(auth.uid(), 'manage_renewals')
      AND (
        public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role,'admin'::public.app_role])
        OR rc.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_manage_renewal_case(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_renewal_case(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.renewal_center_queue(
  _branch_id uuid DEFAULT NULL,
  _queue text DEFAULT 'all',
  _search text DEFAULT NULL,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
) RETURNS TABLE (
  case_id uuid, branch_id uuid, member_id uuid, membership_id uuid,
  member_name text, member_code text, masked_phone text, plan_name text,
  expiry_date date, days_to_expiry integer, stage public.renewal_stage,
  attempts_count integer, voice_attempts_count integer, last_contact_at timestamptz,
  next_action_at timestamptz, claimed_by uuid, claimed_name text,
  snoozed_until timestamptz, outcome text, churn_reason text, paused_reason text,
  renewal_evidence text, value_score numeric, last_visit timestamptz,
  latest_event text, latest_event_at timestamptz, total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_capability(auth.uid(), 'manage_renewals') THEN
    RAISE EXCEPTION 'Not authorized to manage renewals';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT rc.*, COALESCE(p.full_name,'Member') AS member_name, mem.member_code,
      CASE WHEN p.phone IS NULL THEN NULL
           WHEN length(regexp_replace(p.phone,'\D','','g')) >= 4
           THEN '******' || right(regexp_replace(p.phone,'\D','','g'),4)
           ELSE '******' END AS masked_phone,
      mp.name AS plan_name,
      cp.full_name AS claimed_name,
      (SELECT max(ma.check_in) FROM public.member_attendance ma WHERE ma.member_id=rc.member_id) AS last_visit,
      le.event_type AS latest_event, le.created_at AS latest_event_at
    FROM public.renewal_cases rc
    JOIN public.members mem ON mem.id=rc.member_id
    LEFT JOIN public.profiles p ON p.id=mem.user_id
    LEFT JOIN public.membership_plans mp ON mp.id=rc.plan_id
    LEFT JOIN public.profiles cp ON cp.id=rc.claimed_by
    LEFT JOIN LATERAL (
      SELECT e.event_type,e.created_at FROM public.renewal_case_events e
      WHERE e.case_id=rc.id ORDER BY e.created_at DESC LIMIT 1
    ) le ON true
    WHERE (_branch_id IS NULL OR rc.branch_id=_branch_id)
      AND (auth.uid() IS NULL OR public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role,'admin'::public.app_role])
           OR rc.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
      AND (_search IS NULL OR btrim(_search)='' OR p.full_name ILIKE '%'||btrim(_search)||'%'
           OR mem.member_code ILIKE '%'||btrim(_search)||'%')
  ), filtered AS (
    SELECT * FROM base b WHERE CASE COALESCE(_queue,'all')
      WHEN 'due_soon' THEN b.closed_at IS NULL AND b.expiry_date > v_today
      WHEN 'today' THEN b.closed_at IS NULL AND b.expiry_date = v_today
      WHEN 'lapsed' THEN b.closed_at IS NULL AND b.expiry_date < v_today AND b.stage IN ('eligible','reminding','lapsed','staff_followup')
      WHEN 'voice' THEN b.closed_at IS NULL AND b.stage='voice_escalation'
      WHEN 'callback' THEN b.closed_at IS NULL AND b.stage='callback'
      WHEN 'won' THEN b.stage IN ('renewed','win_back')
      WHEN 'lost' THEN b.stage IN ('not_interested','cancelled','churned')
      ELSE true END
  )
  SELECT f.id,f.branch_id,f.member_id,f.membership_id,f.member_name,f.member_code,f.masked_phone,f.plan_name,
    f.expiry_date,(f.expiry_date-v_today)::integer,f.stage,f.attempts_count,f.voice_attempts_count,
    f.last_contact_at,f.next_action_at,f.claimed_by,f.claimed_name,f.snoozed_until,f.outcome,
    f.churn_reason,f.paused_reason,f.renewal_evidence,f.value_score,f.last_visit,
    f.latest_event,f.latest_event_at,count(*) OVER()
  FROM filtered f
  ORDER BY CASE WHEN f.closed_at IS NULL THEN 0 ELSE 1 END, f.next_action_at NULLS LAST, f.expiry_date
  LIMIT LEAST(GREATEST(_limit,1),200) OFFSET GREATEST(_offset,0);
END; $$;
REVOKE EXECUTE ON FUNCTION public.renewal_center_queue(uuid,text,text,integer,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.renewal_center_queue(uuid,text,text,integer,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.renewal_case_action(
  _case_id uuid,
  _action text,
  _snoozed_until timestamptz DEFAULT NULL,
  _outcome text DEFAULT NULL,
  _churn_reason text DEFAULT NULL,
  _note text DEFAULT NULL,
  _assignee uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_case public.renewal_cases%ROWTYPE; v_stage public.renewal_stage; v_close boolean := false;
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
END; $$;
REVOKE EXECUTE ON FUNCTION public.renewal_case_action(uuid,text,timestamptz,text,text,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.renewal_case_action(uuid,text,timestamptz,text,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.renewal_funnel(_branch_id uuid DEFAULT NULL, _days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_capability(auth.uid(),'manage_renewals') THEN RAISE EXCEPTION 'Not authorized'; END IF;
 SELECT jsonb_build_object(
  'eligible',count(*) FILTER(WHERE stage='eligible'),'contacted',count(*) FILTER(WHERE attempts_count>0),
  'responded',count(*) FILTER(WHERE stage IN('callback','staff_followup','renewed','win_back','not_interested','churned')),
  'voice',count(*) FILTER(WHERE voice_attempts_count>0 OR stage='voice_escalation'),
  'renewed',count(*) FILTER(WHERE stage IN('renewed','win_back')),
  'lost',count(*) FILTER(WHERE stage IN('not_interested','cancelled','churned')),
  'open',count(*) FILTER(WHERE closed_at IS NULL),'total',count(*)) INTO v
 FROM public.renewal_cases rc WHERE rc.created_at>=now()-make_interval(days=>GREATEST(_days,1))
 AND (_branch_id IS NULL OR rc.branch_id=_branch_id)
 AND (public.has_any_role(auth.uid(),ARRAY['owner'::public.app_role,'admin'::public.app_role]) OR rc.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())));
 RETURN COALESCE(v,'{}'::jsonb);
END; $$;
REVOKE EXECUTE ON FUNCTION public.renewal_funnel(uuid,integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.renewal_funnel(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_voice_sync_renewal_case()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_stage public.renewal_stage; v_event text;
BEGIN
 IF NEW.renewal_case_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.disposition IS DISTINCT FROM OLD.disposition THEN
   v_event := 'voice_'||COALESCE(NULLIF(NEW.disposition,''),NEW.status,'updated');
   v_stage := CASE
     WHEN NEW.disposition='callback_requested' THEN 'callback'::public.renewal_stage
     WHEN NEW.disposition IN('not_interested','wrong_person') THEN 'not_interested'::public.renewal_stage
     WHEN NEW.disposition='coming_back' THEN 'staff_followup'::public.renewal_stage
     ELSE 'voice_escalation'::public.renewal_stage END;
   UPDATE public.renewal_cases SET stage=v_stage,
     voice_attempts_count=voice_attempts_count+CASE WHEN TG_OP='INSERT' THEN 1 ELSE 0 END,
     next_action_at=CASE WHEN NEW.disposition='callback_requested' THEN COALESCE((NEW.context_payload->>'callback_datetime')::timestamptz,now()+interval '1 day') ELSE next_action_at END,
     outcome=CASE WHEN NEW.disposition='not_interested' THEN 'not_interested' ELSE outcome END,
     updated_at=now() WHERE id=NEW.renewal_case_id AND closed_at IS NULL;
   INSERT INTO public.renewal_case_events(case_id,branch_id,event_type,stage,channel,detail,payload)
   SELECT rc.id,rc.branch_id,v_event,v_stage,'voice',NEW.error_message,
     jsonb_build_object('call_id',NEW.id,'status',NEW.status,'disposition',NEW.disposition)
   FROM public.renewal_cases rc WHERE rc.id=NEW.renewal_case_id;
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tg_voice_sync_renewal_case ON public.voice_call_attempts;
CREATE TRIGGER tg_voice_sync_renewal_case AFTER INSERT OR UPDATE OF status,disposition ON public.voice_call_attempts
FOR EACH ROW EXECUTE FUNCTION public.tg_voice_sync_renewal_case();

CREATE OR REPLACE FUNCTION public.howbody_recover_assessment(_member_id uuid, _scan_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_body uuid; v_posture uuid; v_branch uuid;
BEGIN
 IF auth.uid() IS NOT NULL AND NOT (
   public.has_any_role(auth.uid(),ARRAY['owner'::public.app_role,'admin'::public.app_role])
   OR EXISTS(SELECT 1 FROM public.members m WHERE m.id=_member_id AND m.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
 ) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 SELECT branch_id INTO v_branch FROM public.members WHERE id=_member_id;
 IF v_branch IS NULL THEN RAISE EXCEPTION 'Member not found'; END IF;
 SELECT id INTO v_body FROM public.howbody_body_reports WHERE member_id=_member_id AND scan_id=_scan_id ORDER BY created_at DESC LIMIT 1;
 SELECT id INTO v_posture FROM public.howbody_posture_reports WHERE member_id=_member_id AND scan_id=_scan_id ORDER BY created_at DESC LIMIT 1;
 IF v_body IS NULL AND v_posture IS NULL THEN RAISE EXCEPTION 'No matching reports found'; END IF;
 UPDATE public.howbody_scan_sessions SET status='completed',completed_at=COALESCE(completed_at,now())
 WHERE member_id=_member_id AND scan_id=_scan_id AND status<>'completed';
 RETURN jsonb_build_object('success',true,'member_id',_member_id,'scan_id',_scan_id,'body_report_id',v_body,'posture_report_id',v_posture);
END; $$;
REVOKE EXECUTE ON FUNCTION public.howbody_recover_assessment(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.howbody_recover_assessment(uuid,text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Members view own scan deliveries" ON public.scan_report_deliveries;
CREATE POLICY "Members view own scan deliveries" ON public.scan_report_deliveries
FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.members m WHERE m.id=member_id AND m.user_id=auth.uid())
  OR public.has_any_role(auth.uid(),ARRAY['owner'::public.app_role,'admin'::public.app_role])
  OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
);

-- Safety invariant: rollout remains disabled and legacy reminders stay active.
UPDATE public.renewal_engine_config SET enabled=false,suppress_legacy_expiry_reminders=false;
UPDATE public.automation_rules SET is_active=false WHERE key='renewal_engine_tick' OR worker='edge:renewal-engine-tick';
UPDATE public.settings SET value='false'::jsonb WHERE branch_id IS NULL AND key='renewal_engine_enabled';
