ALTER TABLE public.ai_dashboard_insights ADD COLUMN IF NOT EXISTS forecast jsonb;
CREATE INDEX IF NOT EXISTS ai_dashboard_insights_branch_gen_idx ON public.ai_dashboard_insights (branch_id, generated_at DESC);

GRANT SELECT ON public.ai_dashboard_insights TO authenticated;
GRANT ALL ON public.ai_dashboard_insights TO service_role;
ALTER TABLE public.ai_dashboard_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can delete their own insights" ON public.ai_dashboard_insights;
DROP POLICY IF EXISTS "Users can insert their own insights" ON public.ai_dashboard_insights;
DROP POLICY IF EXISTS "Users can update their own insights" ON public.ai_dashboard_insights;
DROP POLICY IF EXISTS "Users can read their own insights" ON public.ai_dashboard_insights;

CREATE POLICY "Managers read branch insights" ON public.ai_dashboard_insights
FOR SELECT TO authenticated
USING (
  (SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]))
  OR (
    branch_id IS NOT NULL
    AND (SELECT public.has_any_role(auth.uid(), ARRAY['manager']::app_role[]))
    AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
  )
);

CREATE OR REPLACE FUNCTION public.dashboard_sales_forecast(p_branch uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  _ms date := date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date;
  _me date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) + interval '1 month - 1 day')::date;
  _lms date := (date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 month')::date;
  _ms_ts timestamptz := (_ms::timestamp AT TIME ZONE 'Asia/Kolkata');
  _lms_ts timestamptz := (_lms::timestamp AT TIME ZONE 'Asia/Kolkata');
  _res jsonb;
BEGIN
  IF public.rpc_guard_applies('dashboard_sales_forecast') THEN
    IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]) THEN
      IF p_branch IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['manager']::app_role[])
         OR p_branch NOT IN (SELECT public.user_visible_branch_ids(auth.uid())) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  WITH due AS (
    SELECT m.id, m.member_id, m.end_date,
      EXISTS (SELECT 1 FROM public.memberships s WHERE s.member_id = m.member_id AND s.id <> m.id
              AND s.start_date >= m.end_date - 30 AND s.created_at > m.created_at
              AND s.status NOT IN ('cancelled')) AS renewed
    FROM public.memberships m
    WHERE (p_branch IS NULL OR m.branch_id = p_branch)
      AND m.status NOT IN ('cancelled','transferred','upgraded')
      AND m.end_date BETWEEN _lms AND _me
  ),
  pay AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE payment_date >= _ms_ts), 0) AS mtd,
      COALESCE(SUM(amount) FILTER (WHERE payment_date >= _lms_ts AND payment_date < _ms_ts), 0) AS last_month
    FROM public.payments
    WHERE status = 'completed' AND payment_date >= _lms_ts AND (p_branch IS NULL OR branch_id = p_branch)
  ),
  pt AS (
    SELECT
      COUNT(*) FILTER (WHERE created_at >= _ms_ts) AS sold_mtd,
      COALESCE(SUM(price_paid) FILTER (WHERE created_at >= _ms_ts), 0) AS value_mtd,
      COUNT(*) FILTER (WHERE created_at >= _lms_ts AND created_at < _ms_ts) AS sold_last,
      COALESCE(SUM(price_paid) FILTER (WHERE created_at >= _lms_ts AND created_at < _ms_ts), 0) AS value_last
    FROM public.member_pt_packages
    WHERE created_at >= _lms_ts AND status NOT IN ('cancelled','reversed') AND (p_branch IS NULL OR branch_id = p_branch)
  ),
  pt_exp AS (
    SELECT COUNT(*) AS n FROM public.member_pt_packages
    WHERE status = 'active' AND expiry_date BETWEEN _today AND _today + 7 AND (p_branch IS NULL OR branch_id = p_branch)
  ),
  tr AS (
    SELECT t.id, COALESCE(p.full_name, 'Trainer') AS name,
      COALESCE((SELECT SUM(x.price_paid) FROM public.member_pt_packages x WHERE x.trainer_id = t.id AND x.created_at >= _ms_ts AND x.status NOT IN ('cancelled','reversed')), 0) AS pt_revenue,
      (SELECT COUNT(DISTINCT x.member_id) FROM public.member_pt_packages x WHERE x.trainer_id = t.id AND x.status = 'active') AS active_clients,
      (SELECT COUNT(*) FROM public.pt_sessions s WHERE s.trainer_id = t.id AND s.status = 'completed' AND s.scheduled_at >= _ms_ts) AS sessions_done
    FROM public.trainers t LEFT JOIN public.profiles p ON p.id = t.user_id
    WHERE t.is_active AND t.exit_date IS NULL AND (p_branch IS NULL OR t.branch_id = p_branch)
  ),
  avgv AS (
    SELECT COALESCE(AVG(price_paid) FILTER (WHERE price_paid > 0), 0) AS v FROM public.memberships
    WHERE created_at >= now() - interval '90 days' AND (p_branch IS NULL OR branch_id = p_branch)
  )
  SELECT jsonb_build_object(
    'as_of', _today, 'month_start', _ms, 'month_end', _me,
    'days_elapsed', (_today - _ms) + 1, 'days_in_month', (_me - _ms) + 1,
    'collected_mtd', pay.mtd, 'collected_last_month', pay.last_month,
    'renewal', jsonb_build_object(
      'this_month_due', (SELECT COUNT(*) FROM due WHERE end_date >= _ms AND end_date <= _today),
      'this_month_renewed', (SELECT COUNT(*) FROM due WHERE end_date >= _ms AND end_date <= _today AND renewed),
      'last_month_due', (SELECT COUNT(*) FROM due WHERE end_date < _ms),
      'last_month_renewed', (SELECT COUNT(*) FROM due WHERE end_date < _ms AND renewed),
      'remaining_due', (SELECT COUNT(*) FROM due WHERE end_date > _today AND NOT renewed)
    ),
    'avg_membership_value', round(avgv.v, 2),
    'pt', jsonb_build_object('sold_mtd', pt.sold_mtd, 'value_mtd', pt.value_mtd, 'sold_last', pt.sold_last,
                             'value_last', pt.value_last, 'expiring_7d', pt_exp.n),
    'trainers', COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'id' ORDER BY t.pt_revenue DESC, t.active_clients DESC)
                          FROM (SELECT * FROM tr ORDER BY pt_revenue DESC, active_clients DESC LIMIT 5) t), '[]'::jsonb)
  ) INTO _res FROM pay, pt, pt_exp, avgv;
  RETURN _res;
END $$;

REVOKE ALL ON FUNCTION public.dashboard_sales_forecast(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_sales_forecast(uuid) TO authenticated, service_role;