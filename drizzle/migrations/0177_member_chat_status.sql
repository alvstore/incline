CREATE OR REPLACE FUNCTION public.member_chat_status(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_m record;
  v_ms record;
  v_freeze_until date;
  v_dues numeric := 0;
  v_dues_count int := 0;
BEGIN
  SELECT id, status::text AS status, login_disabled_at, branch_id INTO v_m
  FROM members WHERE id = p_member_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Pick the membership that best describes "now":
  -- 1 active covering today, 2 frozen, 3 pending/future active, 4 most recent other.
  SELECT ms.id, ms.status::text AS status, ms.start_date, ms.end_date, mp.name AS plan_name
  INTO v_ms
  FROM memberships ms
  LEFT JOIN membership_plans mp ON mp.id = ms.plan_id
  WHERE ms.member_id = p_member_id
  ORDER BY
    CASE
      WHEN ms.status = 'active' AND ms.start_date <= v_today AND ms.end_date >= v_today THEN 1
      WHEN ms.status = 'frozen' THEN 2
      WHEN ms.status = 'pending' OR (ms.status = 'active' AND ms.start_date > v_today) THEN 3
      ELSE 4
    END,
    ms.end_date DESC NULLS LAST
  LIMIT 1;

  IF v_ms.id IS NOT NULL AND v_ms.status = 'frozen' THEN
    SELECT max(end_date) INTO v_freeze_until
    FROM membership_freeze_history
    WHERE membership_id = v_ms.id AND coalesce(status, 'approved') NOT IN ('rejected', 'cancelled');
  END IF;

  SELECT coalesce(sum(greatest(coalesce(total_amount,0) - coalesce(amount_paid,0), 0)), 0), count(*)
  INTO v_dues, v_dues_count
  FROM invoices
  WHERE member_id = p_member_id AND status IN ('pending', 'partial', 'overdue');

  RETURN jsonb_build_object(
    'member_id', v_m.id,
    'branch_id', v_m.branch_id,
    'member_status', v_m.status,
    'login_disabled', v_m.login_disabled_at IS NOT NULL,
    'today', v_today,
    'membership_id', v_ms.id,
    'membership_status', v_ms.status,
    'start_date', v_ms.start_date,
    'end_date', v_ms.end_date,
    'plan_name', v_ms.plan_name,
    'freeze_until', v_freeze_until,
    'dues', v_dues,
    'dues_count', v_dues_count
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.member_chat_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_chat_status(uuid) TO service_role;