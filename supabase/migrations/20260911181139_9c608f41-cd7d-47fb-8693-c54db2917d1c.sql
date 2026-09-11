-- Retention calling gets a real attempt cycle: up to 3 tries per member,
-- unreached attempts retried after a short gap, connected calls resting for the
-- full cooldown. The next attempt time is computed here so operators can see it.
CREATE OR REPLACE FUNCTION public.voice_retention_candidates(
  _min_absent_days integer DEFAULT 7,
  _cooldown_days integer DEFAULT 7,
  _branch_ids uuid[] DEFAULT NULL::uuid[],
  _recent_contact_days integer DEFAULT 0,
  _max_attempts integer DEFAULT 3,
  _retry_gap_hours integer DEFAULT 4
)
RETURNS TABLE(
  member_id uuid, branch_id uuid, phone text,
  last_seen timestamp with time zone, last_call timestamp with time zone,
  missing_phone boolean, dnd boolean, paused boolean, too_recent boolean,
  in_cooldown boolean, contacted_today boolean, no_visit_data boolean,
  recent_human_contact boolean,
  attempts_cycle integer, attempts_today integer, last_status text,
  last_reached_at timestamp with time zone,
  attempts_exhausted boolean, next_attempt_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      m.id,
      m.branch_id,
      p.phone,
      coalesce(m.do_not_contact, false)
        OR EXISTS (
          SELECT 1 FROM public.whatsapp_chat_settings w
          WHERE w.phone_number = p.phone AND w.do_not_contact = true
        ) AS dnd,
      EXISTS (
        SELECT 1 FROM public.whatsapp_chat_settings w
        WHERE w.phone_number = p.phone
          AND (w.bot_active = false OR w.handoff_requested_at IS NOT NULL
               OR (w.bot_paused_until IS NOT NULL AND w.bot_paused_until > now()))
      ) AS paused,
      (SELECT max(a.check_in) FROM public.member_attendance a WHERE a.member_id = m.id) AS last_seen,
      (SELECT max(v.started_at) FROM public.voice_call_attempts v
        WHERE v.member_id = m.id AND v.source = 'member_retention'
          AND v.status NOT IN ('failed', 'cancelled')) AS last_call,
      -- Last time the member actually picked up: that closes an attempt cycle.
      (SELECT max(v.started_at) FROM public.voice_call_attempts v
        WHERE v.member_id = m.id AND v.source = 'member_retention'
          AND v.status IN ('completed', 'connected', 'in_progress')) AS last_reached_at,
      (SELECT max(v.created_at) FROM public.voice_call_attempts v
        WHERE v.member_id = m.id AND v.source = 'member_retention') AS last_attempt_at,
      (SELECT v.status FROM public.voice_call_attempts v
        WHERE v.member_id = m.id AND v.source = 'member_retention'
        ORDER BY v.created_at DESC LIMIT 1) AS last_status,
      (SELECT count(*) FROM public.voice_call_attempts v
        WHERE v.member_id = m.id AND v.source = 'member_retention'
          AND (v.created_at AT TIME ZONE 'Asia/Kolkata')::date
              = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS attempts_today,
      (
        _recent_contact_days > 0 AND EXISTS (
          SELECT 1 FROM public.communication_logs c
          WHERE c.member_id = m.id
            AND c.created_at > now() - make_interval(days => _recent_contact_days)
        )
      ) AS recent_human_contact
    FROM public.members m
    JOIN public.branches b ON b.id = m.branch_id AND b.is_active = true
    LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.status = 'active'
      AND (_branch_ids IS NULL OR array_length(_branch_ids, 1) IS NULL OR m.branch_id = ANY (_branch_ids))
      AND EXISTS (
        SELECT 1 FROM public.memberships ms
        WHERE ms.member_id = m.id AND ms.status = 'active'
      )
  ),
  cycle AS (
    SELECT b.*,
      -- Attempts since the member last picked up — that is the live cycle.
      (SELECT count(*) FROM public.voice_call_attempts v
        WHERE v.member_id = b.id AND v.source = 'member_retention'
          AND (b.last_reached_at IS NULL OR v.created_at > b.last_reached_at)
          AND v.created_at > now() - make_interval(days => greatest(_cooldown_days, 1))
      ) AS attempts_cycle
    FROM base b
  )
  SELECT
    id, branch_id, phone, last_seen, last_call,
    (phone IS NULL OR phone !~ '^\+91[6-9][0-9]{9}$') AS missing_phone,
    dnd,
    paused,
    (last_seen IS NOT NULL AND last_seen > now() - make_interval(days => _min_absent_days)) AS too_recent,
    -- A member who picked up rests for the full cooldown. A member we could not
    -- reach only waits for the short retry gap, until the attempt cap is hit.
    CASE
      WHEN last_reached_at IS NOT NULL
        AND last_reached_at > now() - make_interval(days => greatest(_cooldown_days, 0)) THEN true
      WHEN last_attempt_at IS NOT NULL
        AND last_attempt_at > now() - make_interval(hours => greatest(_retry_gap_hours, 1)) THEN true
      ELSE false
    END AS in_cooldown,
    -- Same-day retries are allowed, but never more than the attempt cap.
    (attempts_today >= greatest(_max_attempts, 1)) AS contacted_today,
    (last_seen IS NULL) AS no_visit_data,
    recent_human_contact,
    attempts_cycle::integer,
    attempts_today::integer,
    last_status,
    last_reached_at,
    (last_reached_at IS NULL AND attempts_cycle >= greatest(_max_attempts, 1)) AS attempts_exhausted,
    CASE
      WHEN last_reached_at IS NOT NULL
        THEN last_reached_at + make_interval(days => greatest(_cooldown_days, 0))
      WHEN attempts_cycle >= greatest(_max_attempts, 1) THEN NULL
      WHEN last_attempt_at IS NOT NULL
        THEN last_attempt_at + make_interval(hours => greatest(_retry_gap_hours, 1))
      ELSE now()
    END AS next_attempt_at
  FROM cycle;
$function$;

GRANT EXECUTE ON FUNCTION public.voice_retention_candidates(integer, integer, uuid[], integer, integer, integer)
  TO authenticated, service_role;