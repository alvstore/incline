ALTER TABLE public.upgrade_offers ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.upgrade_window_summary(p_branch_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stats JSONB;
  v_rows JSONB;
BEGIN
  PERFORM public.assert_branch_staff(p_branch_id, false, 'view upgrade window stats');

  SELECT jsonb_build_object(
    'in_window', COUNT(*) FILTER (WHERE status IN ('pending','day7_sent','day12_sent') AND window_ends_at >= now()),
    'sent_7d', COUNT(*) FILTER (WHERE last_sent_at >= now() - interval '7 days'),
    'converted_month', COUNT(*) FILTER (WHERE status = 'converted' AND converted_at >= date_trunc('month', now())),
    'conversion_revenue_month', COALESCE(SUM(upgrade_cost) FILTER (WHERE status = 'converted' AND converted_at >= date_trunc('month', now())), 0)
  ) INTO v_stats
  FROM public.upgrade_offers
  WHERE branch_id = p_branch_id;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT o.id, o.status, o.window_ends_at, o.upgrade_cost, o.annual_price, o.already_paid,
           o.converted_at, m.id AS member_id,
           COALESCE(p.full_name, 'Member') AS member_name,
           mp.name AS plan_name
      FROM public.upgrade_offers o
      JOIN public.members m ON m.id = o.member_id
      LEFT JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN public.memberships ms ON ms.id = o.membership_id
      LEFT JOIN public.membership_plans mp ON mp.id = ms.plan_id
     WHERE o.branch_id = p_branch_id
       AND (o.status = 'converted' OR (o.status IN ('pending','day7_sent','day12_sent') AND o.window_ends_at >= now()))
     ORDER BY (o.status = 'converted') ASC, o.window_ends_at ASC
     LIMIT 50
  ) t;

  RETURN jsonb_build_object('stats', v_stats, 'offers', v_rows);
END;
$$;
GRANT EXECUTE ON FUNCTION public.upgrade_window_summary(UUID) TO authenticated, service_role;