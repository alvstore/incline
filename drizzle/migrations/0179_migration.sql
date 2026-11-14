-- Renewal Center v2: one live case per member; closed cycles become history.

-- 1) Close older open cases when a new cycle opens for the same member.
CREATE OR REPLACE FUNCTION public.tg_renewal_case_supersede()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, branch_id, stage FROM public.renewal_cases
           WHERE member_id = NEW.member_id AND closed_at IS NULL AND id <> NEW.id
  LOOP
    UPDATE public.renewal_cases
       SET closed_at = now(), outcome = COALESCE(outcome, 'superseded'), updated_at = now()
     WHERE id = r.id;
    INSERT INTO public.renewal_case_events(case_id, branch_id, event_type, stage, detail)
    VALUES (r.id, r.branch_id, 'superseded', r.stage, 'Closed because a newer membership cycle opened');
  END LOOP;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_renewal_case_supersede() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_renewal_case_supersede ON public.renewal_cases;
CREATE TRIGGER trg_renewal_case_supersede BEFORE INSERT ON public.renewal_cases
FOR EACH ROW EXECUTE FUNCTION public.tg_renewal_case_supersede();

CREATE UNIQUE INDEX IF NOT EXISTS renewal_cases_one_open_per_member
  ON public.renewal_cases(member_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS renewal_cases_closed_at_idx
  ON public.renewal_cases(closed_at DESC) WHERE closed_at IS NOT NULL;

-- 2) Queue: "all" = open pipeline only; won/lost scoped to a period; cycle info.
DROP FUNCTION IF EXISTS public.renewal_center_queue(uuid, text, text, integer, integer);
CREATE FUNCTION public.renewal_center_queue(_branch_id uuid DEFAULT NULL, _queue text DEFAULT 'all', _search text DEFAULT NULL, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _since date DEFAULT NULL)
 RETURNS TABLE(case_id uuid, branch_id uuid, member_id uuid, membership_id uuid, member_name text, member_code text, masked_phone text, plan_name text, expiry_date date, days_to_expiry integer, stage renewal_stage, attempts_count integer, voice_attempts_count integer, last_contact_at timestamptz, next_action_at timestamptz, claimed_by uuid, claimed_name text, snoozed_until timestamptz, outcome text, churn_reason text, paused_reason text, renewal_evidence text, value_score numeric, last_visit timestamptz, latest_event text, latest_event_at timestamptz, closed_at timestamptz, cycle_number integer, prior_renewals integer, total_count bigint)
 LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_since date := COALESCE(_since, date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date);
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
      mp.name AS plan_name, cp.full_name AS claimed_name
    FROM public.renewal_cases rc
    JOIN public.members mem ON mem.id=rc.member_id
    LEFT JOIN public.profiles p ON p.id=mem.user_id
    LEFT JOIN public.membership_plans mp ON mp.id=rc.plan_id
    LEFT JOIN public.profiles cp ON cp.id=rc.claimed_by
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
      WHEN 'won' THEN b.stage IN ('renewed','win_back') AND COALESCE(b.closed_at,b.updated_at) >= v_since
      WHEN 'lost' THEN b.stage IN ('not_interested','cancelled','churned') AND COALESCE(b.closed_at,b.updated_at) >= v_since
      ELSE b.closed_at IS NULL END
  )
  SELECT f.id,f.branch_id,f.member_id,f.membership_id,f.member_name,f.member_code,f.masked_phone,f.plan_name,
    f.expiry_date,(f.expiry_date-v_today)::integer,f.stage,f.attempts_count,f.voice_attempts_count,
    f.last_contact_at,f.next_action_at,f.claimed_by,f.claimed_name,f.snoozed_until,f.outcome,
    f.churn_reason,f.paused_reason,f.renewal_evidence,f.value_score,
    (SELECT max(ma.check_in) FROM public.member_attendance ma WHERE ma.member_id=f.member_id),
    le.event_type, le.created_at, f.closed_at,
    (SELECT count(*)::int FROM public.renewal_cases h WHERE h.member_id=f.member_id AND h.created_at<=f.created_at),
    (SELECT count(*)::int FROM public.renewal_cases h WHERE h.member_id=f.member_id AND h.created_at<f.created_at AND h.stage IN ('renewed','win_back')),
    count(*) OVER()
  FROM filtered f
  LEFT JOIN LATERAL (
    SELECT e.event_type,e.created_at FROM public.renewal_case_events e
    WHERE e.case_id=f.id ORDER BY e.created_at DESC LIMIT 1
  ) le ON true
  ORDER BY CASE WHEN f.closed_at IS NULL THEN 0 ELSE 1 END, f.closed_at DESC NULLS LAST, f.next_action_at NULLS LAST, f.expiry_date
  LIMIT LEAST(GREATEST(_limit,1),200) OFFSET GREATEST(_offset,0);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.renewal_center_queue(uuid,text,text,integer,integer,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renewal_center_queue(uuid,text,text,integer,integer,date) TO authenticated, service_role;

-- 3) Counts match the queue.
DROP FUNCTION IF EXISTS public.renewal_queue_counts(uuid);
CREATE FUNCTION public.renewal_queue_counts(_branch_id uuid DEFAULT NULL, _since date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_since date := COALESCE(_since, date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date);
  v_result jsonb;
BEGIN
  IF public.rpc_guard_applies('renewal_queue_counts') AND (auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), 'manage_renewals')) THEN
    RAISE EXCEPTION 'Not authorized to manage renewals';
  END IF;
  SELECT jsonb_build_object(
    'all',      count(*) FILTER (WHERE rc.closed_at IS NULL),
    'due_soon', count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.expiry_date > v_today),
    'today',    count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.expiry_date = v_today),
    'lapsed',   count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.expiry_date < v_today AND rc.stage IN ('eligible','reminding','lapsed','staff_followup')),
    'voice',    count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.stage = 'voice_escalation'),
    'callback', count(*) FILTER (WHERE rc.closed_at IS NULL AND rc.stage = 'callback'),
    'won',      count(*) FILTER (WHERE rc.stage IN ('renewed','win_back') AND COALESCE(rc.closed_at,rc.updated_at) >= v_since),
    'lost',     count(*) FILTER (WHERE rc.stage IN ('not_interested','cancelled','churned') AND COALESCE(rc.closed_at,rc.updated_at) >= v_since)
  ) INTO v_result
  FROM public.renewal_cases rc
  WHERE (_branch_id IS NULL OR rc.branch_id = _branch_id)
    AND (auth.uid() IS NULL
         OR public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role,'admin'::public.app_role])
         OR rc.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())));
  RETURN COALESCE(v_result, '{}'::jsonb);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.renewal_queue_counts(uuid,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renewal_queue_counts(uuid,date) TO authenticated, service_role;

-- 4) Member cycle history for the side panel.
CREATE OR REPLACE FUNCTION public.renewal_member_history(_member_id uuid)
RETURNS TABLE(case_id uuid, expiry_date date, stage renewal_stage, outcome text, attempts_count integer, voice_attempts_count integer, created_at timestamptz, closed_at timestamptz, plan_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.rpc_guard_applies('renewal_member_history') AND (auth.uid() IS NULL OR NOT public.has_capability(auth.uid(), 'manage_renewals')) THEN
    RAISE EXCEPTION 'Not authorized to manage renewals';
  END IF;
  RETURN QUERY
  SELECT rc.id, rc.expiry_date, rc.stage, rc.outcome, rc.attempts_count, rc.voice_attempts_count, rc.created_at, rc.closed_at, mp.name
  FROM public.renewal_cases rc
  LEFT JOIN public.membership_plans mp ON mp.id = rc.plan_id
  WHERE rc.member_id = _member_id
    AND (auth.uid() IS NULL
         OR public.has_any_role(auth.uid(), ARRAY['owner'::public.app_role,'admin'::public.app_role])
         OR rc.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  ORDER BY rc.created_at DESC
  LIMIT 50;
END; $function$;
REVOKE EXECUTE ON FUNCTION public.renewal_member_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renewal_member_history(uuid) TO authenticated, service_role;