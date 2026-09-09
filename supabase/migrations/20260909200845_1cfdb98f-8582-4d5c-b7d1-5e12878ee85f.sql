CREATE OR REPLACE FUNCTION public.voice_retention_blocked(
  p_branch uuid DEFAULT NULL,
  p_limit  integer DEFAULT 100
)
RETURNS TABLE(
  member_id uuid,
  member_name text,
  member_code text,
  masked_phone text,
  branch_id uuid,
  branch_name text,
  last_visit timestamptz,
  days_absent integer,
  last_call_at timestamptz,
  skip_reason text,
  total_count bigint
)
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
        WHEN c.contacted_today        THEN 'Already contacted today'
        WHEN c.in_cooldown            THEN 'Called recently — inside cooldown'
        WHEN c.recent_human_contact   THEN 'Our team spoke to them recently'
        WHEN c.too_recent             THEN 'Visited recently — not absent long enough'
        ELSE 'Not eligible'
      END AS reason
    FROM public.voice_retention_candidates(
      coalesce(v_min, 7), coalesce(v_cooldown, 7), v_branches, coalesce(v_recent, 3)
    ) c
    WHERE c.missing_phone OR c.dnd OR c.paused OR c.too_recent
       OR c.in_cooldown OR c.contacted_today OR c.no_visit_data OR c.recent_human_contact
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
    count(*) OVER ()
  FROM blocked b
  JOIN public.members m ON m.id = b.member_id
  LEFT JOIN public.profiles pr ON pr.id = m.user_id
  LEFT JOIN public.branches br ON br.id = b.branch_id
  ORDER BY b.last_seen ASC NULLS FIRST
  LIMIT v_limit;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.voice_retention_blocked(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.voice_retention_blocked(uuid, integer) TO authenticated;