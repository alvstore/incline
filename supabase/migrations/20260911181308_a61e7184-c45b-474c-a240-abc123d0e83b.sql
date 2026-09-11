DROP FUNCTION IF EXISTS public.voice_retention_queue(uuid, integer, integer);
CREATE OR REPLACE FUNCTION public.voice_retention_queue(p_branch uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(member_id uuid, member_name text, member_code text, masked_phone text, branch_id uuid, branch_name text, last_visit timestamp with time zone, days_absent integer, plan_name text, plan_expiry date, trainer_name text, last_call_at timestamp with time zone, last_call_id uuid, last_disposition text, eligible_at timestamp with time zone, attempts_cycle integer, attempts_today integer, next_attempt_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_branches uuid[];
  v_min int;
  v_cooldown int;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT array_agg(b) INTO v_branches FROM public.user_visible_branch_ids(v_uid) b;
  IF p_branch IS NOT NULL THEN
    IF NOT (p_branch = ANY (coalesce(v_branches, ARRAY[]::uuid[]))) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
    v_branches := ARRAY[p_branch];
  END IF;

  SELECT
    coalesce((retention_automation ->> 'min_absent_days')::int, 7),
    coalesce((retention_automation ->> 'cooldown_days')::int, 7)
  INTO v_min, v_cooldown
  FROM public.voice_provider_integrations
  WHERE provider = 'sarvam'
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  RETURN QUERY
  WITH eligible AS (
    SELECT c.*
    FROM public.voice_retention_candidates(coalesce(v_min, 7), coalesce(v_cooldown, 7), v_branches) c
    WHERE NOT c.missing_phone AND NOT c.dnd AND NOT c.paused
      AND NOT c.too_recent AND NOT c.contacted_today AND NOT c.in_cooldown
      AND NOT c.attempts_exhausted
  ), enriched AS (
    SELECT
      e.member_id AS mid,
      coalesce(pr.full_name, 'Unknown') AS m_name,
      m.member_code AS m_code,
      public.voice_mask_phone(e.phone) AS m_phone,
      e.branch_id AS b_id,
      br.name AS b_name,
      e.last_seen AS l_visit,
      CASE WHEN e.last_seen IS NULL THEN NULL
           ELSE (EXTRACT(day FROM (now() - e.last_seen)))::int END AS d_absent,
      (SELECT mp.name FROM public.memberships ms
        JOIN public.membership_plans mp ON mp.id = ms.plan_id
        WHERE ms.member_id = e.member_id ORDER BY ms.created_at DESC LIMIT 1) AS p_name,
      (SELECT ms.end_date FROM public.memberships ms
        WHERE ms.member_id = e.member_id ORDER BY ms.created_at DESC LIMIT 1) AS p_expiry,
      tr.full_name AS t_name,
      lc.started_at AS lc_at,
      lc.id AS lc_id,
      lc.disposition AS lc_disp,
      e.attempts_cycle AS a_cycle,
      e.attempts_today AS a_today,
      e.next_attempt_at AS n_at,
      count(*) OVER () AS n_total
    FROM eligible e
    JOIN public.members m ON m.id = e.member_id
    LEFT JOIN public.profiles pr ON pr.id = m.user_id
    LEFT JOIN public.branches br ON br.id = e.branch_id
    LEFT JOIN public.trainers tn ON tn.id = m.assigned_trainer_id
    LEFT JOIN public.profiles tr ON tr.id = tn.user_id
    LEFT JOIN LATERAL (
      SELECT v.id, v.started_at, v.disposition
      FROM public.voice_call_attempts v
      WHERE v.member_id = e.member_id
      ORDER BY v.started_at DESC NULLS LAST
      LIMIT 1
    ) lc ON true
  )
  SELECT
    mid, m_name, m_code, m_phone, b_id, b_name, l_visit, d_absent,
    p_name, p_expiry, t_name, lc_at, lc_id, lc_disp,
    coalesce(n_at, now()) AS eligible_at,
    a_cycle, a_today, n_at,
    n_total
  FROM enriched
  ORDER BY l_visit ASC NULLS FIRST, m_name ASC
  LIMIT v_limit OFFSET v_offset;
END;
$function$;

DROP FUNCTION IF EXISTS public.voice_retention_blocked(uuid, integer);
CREATE OR REPLACE FUNCTION public.voice_retention_blocked(p_branch uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(member_id uuid, member_name text, member_code text, masked_phone text, branch_id uuid, branch_name text, last_visit timestamp with time zone, days_absent integer, last_call_at timestamp with time zone, skip_reason text, attempts_cycle integer, next_attempt_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_branches uuid[];
  v_min int;
  v_cooldown int;
  v_recent int;
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 300);
BEGIN
  IF v_uid IS NULL OR NOT public.has_any_role(v_uid, ARRAY['owner','admin','manager','staff']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT array_agg(b) INTO v_branches FROM public.user_visible_branch_ids(v_uid) b;
  IF p_branch IS NOT NULL THEN
    IF NOT (p_branch = ANY (coalesce(v_branches, ARRAY[]::uuid[]))) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
    v_branches := ARRAY[p_branch];
  END IF;

  SELECT
    coalesce((retention_automation ->> 'min_absent_days')::int, 7),
    coalesce((retention_automation ->> 'cooldown_days')::int, 7),
    coalesce((retention_automation ->> 'exclude_recent_human_contact_days')::int, 3)
  INTO v_min, v_cooldown, v_recent
  FROM public.voice_provider_integrations
  WHERE provider = 'sarvam'
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  RETURN QUERY
  WITH blocked AS (
    SELECT c.*,
      CASE
        WHEN c.missing_phone          THEN 'No mobile number on file'
        WHEN c.dnd                    THEN 'Asked not to be contacted'
        WHEN c.paused                 THEN 'Calling paused for this member'
        WHEN c.no_visit_data          THEN 'No visit history yet — never auto-called'
        WHEN c.attempts_exhausted     THEN 'Tried the maximum times — no answer'
        WHEN c.contacted_today        THEN 'Already tried the maximum times today'
        WHEN c.in_cooldown AND c.last_reached_at IS NOT NULL THEN 'Spoke to them recently — resting'
        WHEN c.in_cooldown            THEN 'Just tried — waiting before the next attempt'
        WHEN c.recent_human_contact   THEN 'Our team spoke to them recently'
        WHEN c.too_recent             THEN 'Visited recently — not absent long enough'
        ELSE 'Not eligible'
      END AS reason
    FROM public.voice_retention_candidates(
      coalesce(v_min, 7), coalesce(v_cooldown, 7), v_branches, coalesce(v_recent, 3)
    ) c
    WHERE c.missing_phone OR c.dnd OR c.paused OR c.too_recent
       OR c.in_cooldown OR c.contacted_today OR c.no_visit_data
       OR c.recent_human_contact OR c.attempts_exhausted
  )
  SELECT
    b.member_id,
    coalesce(pr.full_name, 'Unknown'),
    m.member_code,
    public.voice_mask_phone(b.phone),
    b.branch_id,
    br.name,
    b.last_seen,
    CASE WHEN b.last_seen IS NULL THEN NULL
         ELSE (EXTRACT(day FROM (now() - b.last_seen)))::int END,
    b.last_call,
    b.reason,
    b.attempts_cycle,
    b.next_attempt_at,
    count(*) OVER ()
  FROM blocked b
  JOIN public.members m ON m.id = b.member_id
  LEFT JOIN public.profiles pr ON pr.id = m.user_id
  LEFT JOIN public.branches br ON br.id = b.branch_id
  ORDER BY b.last_seen ASC NULLS FIRST
  LIMIT v_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.voice_retention_queue(uuid, integer, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.voice_retention_blocked(uuid, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.voice_retention_queue(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.voice_retention_blocked(uuid, integer) TO authenticated;