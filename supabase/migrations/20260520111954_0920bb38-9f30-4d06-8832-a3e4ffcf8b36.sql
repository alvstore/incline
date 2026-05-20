
-- analytics_revenue_series: alias CTE columns so they don't collide with OUT params
CREATE OR REPLACE FUNCTION public.analytics_revenue_series(
  p_branch uuid DEFAULT NULL,
  p_from date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 365),
  p_to date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  p_grain text DEFAULT 'month'
)
RETURNS TABLE(period date, gross numeric, refunds numeric, reversals numeric, net numeric, txn_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_grain NOT IN ('day','week','month') THEN
    RAISE EXCEPTION 'invalid grain %', p_grain;
  END IF;

  IF auth.uid() IS NULL OR NOT has_capability(auth.uid(), 'view_financials') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT
      date_trunc(p_grain, (p.payment_date AT TIME ZONE 'Asia/Kolkata'))::date AS bucket,
      p.amount,
      p.status,
      p.voided_at,
      p.reversal_of,
      p.payment_source
    FROM public.payments p
    WHERE p.payment_date >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND p.payment_date <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND (p_branch IS NULL OR p.branch_id = p_branch)
      AND COALESCE(p.payment_source,'') NOT IN ('wallet_topup','wallet_refund','internal_transfer')
  )
  SELECT
    s.bucket AS period,
    COALESCE(SUM(s.amount) FILTER (WHERE s.status='completed' AND s.voided_at IS NULL AND s.reversal_of IS NULL), 0) AS gross,
    COALESCE(SUM(s.amount) FILTER (WHERE s.status='refunded'), 0) AS refunds,
    COALESCE(SUM(s.amount) FILTER (WHERE s.status='completed' AND s.reversal_of IS NOT NULL), 0) AS reversals,
    COALESCE(SUM(s.amount) FILTER (WHERE s.status='completed' AND s.voided_at IS NULL AND s.reversal_of IS NULL), 0)
      - COALESCE(SUM(s.amount) FILTER (WHERE s.status='completed' AND s.reversal_of IS NOT NULL), 0)
      - COALESCE(SUM(s.amount) FILTER (WHERE s.status='refunded'), 0) AS net,
    COUNT(*)::int AS txn_count
  FROM src s
  GROUP BY s.bucket
  ORDER BY s.bucket;
END;
$function$;

-- analytics_revenue_by_plan: alias plan_name in CTE to avoid collision
CREATE OR REPLACE FUNCTION public.analytics_revenue_by_plan(
  p_branch uuid DEFAULT NULL,
  p_from date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 365),
  p_to date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(plan_name text, revenue numeric, txn_count integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT has_capability(auth.uid(), 'view_financials') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH paid AS (
    SELECT p.id, p.amount, p.invoice_id
    FROM public.payments p
    WHERE p.status = 'completed'
      AND p.voided_at IS NULL
      AND p.reversal_of IS NULL
      AND p.payment_date >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND p.payment_date <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND (p_branch IS NULL OR p.branch_id = p_branch)
      AND COALESCE(p.payment_source,'') NOT IN ('wallet_topup','wallet_refund','internal_transfer')
  ),
  alloc AS (
    SELECT
      COALESCE(mp.name, 'Other / POS') AS pname,
      paid.amount * (ii.unit_price * ii.quantity)::numeric
        / NULLIF(SUM(ii.unit_price * ii.quantity) OVER (PARTITION BY paid.id), 0) AS allocated
    FROM paid
    JOIN public.invoice_items ii ON ii.invoice_id = paid.invoice_id
    LEFT JOIN public.memberships m ON ii.reference_type = 'membership' AND ii.reference_id = m.id
    LEFT JOIN public.membership_plans mp ON m.plan_id = mp.id
  )
  SELECT a.pname AS plan_name,
         ROUND(SUM(a.allocated)::numeric, 2) AS revenue,
         COUNT(*)::int AS txn_count
  FROM alloc a
  GROUP BY a.pname
  ORDER BY revenue DESC NULLS LAST
  LIMIT p_limit;
END;
$function$;
