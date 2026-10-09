CREATE OR REPLACE FUNCTION public.referral_workspace_summary(p_branch_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_is_global boolean;
  v_result jsonb;
BEGIN
  IF public.rpc_guard_applies('referral_workspace_summary') THEN
    IF v_user IS NULL OR NOT public.has_any_role(v_user, ARRAY['owner','admin','manager']::public.app_role[]) THEN
      RAISE EXCEPTION 'forbidden: referral workspace requires management access' USING ERRCODE = '42501';
    END IF;

    IF p_branch_id IS NULL AND NOT public.has_any_role(v_user, ARRAY['owner','admin']::public.app_role[]) THEN
      RAISE EXCEPTION 'forbidden: managers must select an assigned branch' USING ERRCODE = '42501';
    END IF;

    IF p_branch_id IS NOT NULL
       AND NOT public.has_any_role(v_user, ARRAY['owner','admin']::public.app_role[])
       AND p_branch_id NOT IN (SELECT public.managed_branch_ids(v_user)) THEN
      RAISE EXCEPTION 'forbidden: branch is not assigned to this manager' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_is_global := p_branch_id IS NULL;

  WITH scoped_referrals AS (
    SELECT r.*
    FROM public.referrals r
    JOIN public.members m ON m.id = r.referrer_member_id
    WHERE v_is_global OR m.branch_id = p_branch_id
  ),
  scoped_rewards AS (
    SELECT rr.*
    FROM public.referral_rewards rr
    JOIN scoped_referrals r ON r.id = rr.referral_id
  ),
  weeks AS (
    SELECT generate_series(
      date_trunc('week', now()) - interval '11 weeks',
      date_trunc('week', now()),
      interval '1 week'
    ) AS week_start
  ),
  weekly AS (
    SELECT
      w.week_start,
      count(r.id)::int AS referred,
      count(r.id) FILTER (WHERE r.status = 'converted' OR r.lifecycle_status IN ('converted','rewarded','claimed'))::int AS converted
    FROM weeks w
    LEFT JOIN scoped_referrals r
      ON r.created_at >= w.week_start
     AND r.created_at < w.week_start + interval '1 week'
    GROUP BY w.week_start
    ORDER BY w.week_start
  ),
  metrics AS (
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status = 'converted' OR lifecycle_status IN ('converted','rewarded','claimed'))::int AS converted,
      count(*) FILTER (WHERE status IN ('new','contacted','qualified','negotiation') AND lifecycle_status NOT IN ('converted','rewarded','claimed'))::int AS awaiting_conversion
    FROM scoped_referrals
  ),
  reward_metrics AS (
    SELECT
      count(*) FILTER (WHERE claim_status = 'pending_approval')::int AS awaiting_approval,
      count(*) FILTER (WHERE is_claimed)::int AS credited_count,
      coalesce(sum(reward_value) FILTER (WHERE is_claimed), 0)::numeric AS credited_value,
      count(*) FILTER (WHERE NOT is_claimed AND coalesce(claim_status, 'available') NOT IN ('pending_approval','rejected'))::int AS available_to_claim
    FROM scoped_rewards
  )
  SELECT jsonb_build_object(
    'total', m.total,
    'converted', m.converted,
    'awaiting_conversion', m.awaiting_conversion,
    'conversion_rate', CASE WHEN m.total = 0 THEN 0 ELSE round((m.converted::numeric / m.total::numeric) * 100, 1) END,
    'awaiting_approval', rm.awaiting_approval,
    'available_to_claim', rm.available_to_claim,
    'credited_count', rm.credited_count,
    'credited_value', rm.credited_value,
    'weekly', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'week_start', weekly.week_start,
      'referred', weekly.referred,
      'converted', weekly.converted
    ) ORDER BY weekly.week_start) FROM weekly), '[]'::jsonb),
    'funnel', jsonb_build_array(
      jsonb_build_object('stage', 'Referred', 'value', m.total),
      jsonb_build_object('stage', 'Converted', 'value', m.converted),
      jsonb_build_object('stage', 'Reward issued', 'value', (SELECT count(*)::int FROM scoped_rewards)),
      jsonb_build_object('stage', 'Awaiting approval', 'value', rm.awaiting_approval),
      jsonb_build_object('stage', 'Credited', 'value', rm.credited_count)
    )
  ) INTO v_result
  FROM metrics m CROSS JOIN reward_metrics rm;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.referral_workspace_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_workspace_summary(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.referral_workspace_summary(uuid) IS 'Branch-scoped referral KPI, funnel, and 12-week trend summary for the management workspace.';