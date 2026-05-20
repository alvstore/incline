
-- 1) check_out_method column + open-session index
ALTER TABLE public.member_attendance
  ADD COLUMN IF NOT EXISTS check_out_method text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_attendance_open
  ON public.member_attendance (branch_id, check_in)
  WHERE check_out IS NULL;

-- 2) Auto-close stale sessions
CREATE OR REPLACE FUNCTION public.auto_close_stale_attendance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.member_attendance
     SET check_out = check_in + interval '90 minutes',
         check_out_method = 'auto',
         notes = COALESCE(notes,'') ||
                 CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE ' | ' END ||
                 'auto-closed: no manual checkout'
   WHERE check_out IS NULL
     AND check_in < now() - interval '6 hours';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_close_stale_attendance() FROM public;
GRANT EXECUTE ON FUNCTION public.auto_close_stale_attendance() TO service_role;

-- Schedule every 15 minutes (idempotent unschedule first)
DO $$
BEGIN
  PERFORM cron.unschedule('auto-close-attendance')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-attendance');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-close-attendance',
  '*/15 * * * *',
  $$ SELECT public.auto_close_stale_attendance(); $$
);

-- 3) Analytics: per-member-per-day session duration (IST-aware)
CREATE OR REPLACE FUNCTION public.analytics_session_duration_daily(
  p_branch uuid DEFAULT NULL,
  p_days   integer DEFAULT 14
)
RETURNS TABLE(
  day             date,
  avg_minutes     numeric,
  member_days     integer,
  sessions_total  integer,
  sessions_auto   integer
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      member_id,
      (check_in AT TIME ZONE 'Asia/Kolkata')::date AS day,
      EXTRACT(EPOCH FROM (check_out - check_in))/60 AS minutes,
      check_out_method
    FROM public.member_attendance
    WHERE check_in >= now() - make_interval(days => p_days)
      AND check_out IS NOT NULL
      AND (p_branch IS NULL OR branch_id = p_branch)
      AND (has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::app_role[])
           OR member_id = get_member_id(auth.uid()))
  ),
  capped AS (
    SELECT member_id, day,
           LEAST(GREATEST(minutes,0), 240) AS minutes,
           check_out_method
    FROM base
    WHERE minutes > 0
  ),
  per_member_day AS (
    SELECT day, member_id,
           SUM(minutes) FILTER (WHERE check_out_method <> 'auto') AS manual_minutes,
           COUNT(*)     AS sessions,
           COUNT(*) FILTER (WHERE check_out_method = 'auto') AS auto_sessions
    FROM capped
    GROUP BY day, member_id
  )
  SELECT
    day,
    ROUND(AVG(manual_minutes) FILTER (WHERE manual_minutes IS NOT NULL AND manual_minutes > 0)::numeric, 1) AS avg_minutes,
    COUNT(*) FILTER (WHERE manual_minutes IS NOT NULL AND manual_minutes > 0)::int AS member_days,
    COALESCE(SUM(sessions),0)::int AS sessions_total,
    COALESCE(SUM(auto_sessions),0)::int AS sessions_auto
  FROM per_member_day
  GROUP BY day
  ORDER BY day;
$$;

GRANT EXECUTE ON FUNCTION public.analytics_session_duration_daily(uuid, integer) TO authenticated;

-- 4) Analytics: revenue series (IST-aware, lifecycle-aware)
CREATE OR REPLACE FUNCTION public.analytics_revenue_series(
  p_branch uuid    DEFAULT NULL,
  p_from   date    DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date - 365,
  p_to     date    DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  p_grain  text    DEFAULT 'month'
)
RETURNS TABLE(
  period    date,
  gross     numeric,
  refunds   numeric,
  reversals numeric,
  net       numeric,
  txn_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_grain NOT IN ('day','week','month') THEN
    RAISE EXCEPTION 'invalid grain %', p_grain;
  END IF;

  IF NOT has_capability(auth.uid(), 'view_financials') THEN
    RAISE EXCEPTION 'forbidden: view_financials required';
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT
      date_trunc(p_grain, (payment_date AT TIME ZONE 'Asia/Kolkata'))::date AS period,
      amount,
      status,
      voided_at,
      reversal_of,
      payment_source
    FROM public.payments p
    WHERE payment_date >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND payment_date <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
      AND (p_branch IS NULL OR p.branch_id = p_branch)
      AND COALESCE(payment_source,'') NOT IN ('wallet_topup','wallet_refund','internal_transfer')
  )
  SELECT
    period,
    COALESCE(SUM(amount) FILTER (WHERE status='completed' AND voided_at IS NULL AND reversal_of IS NULL), 0) AS gross,
    COALESCE(SUM(amount) FILTER (WHERE status='refunded'), 0) AS refunds,
    COALESCE(SUM(amount) FILTER (WHERE status='completed' AND reversal_of IS NOT NULL), 0) AS reversals,
    COALESCE(SUM(amount) FILTER (WHERE status='completed' AND voided_at IS NULL AND reversal_of IS NULL), 0)
      - COALESCE(SUM(amount) FILTER (WHERE status='completed' AND reversal_of IS NOT NULL), 0)
      - COALESCE(SUM(amount) FILTER (WHERE status='refunded'), 0) AS net,
    COUNT(*)::int AS txn_count
  FROM src
  GROUP BY period
  ORDER BY period;
END;
$$;

GRANT EXECUTE ON FUNCTION public.analytics_revenue_series(uuid, date, date, text) TO authenticated;

-- 5) Analytics: revenue by plan (actual money received)
CREATE OR REPLACE FUNCTION public.analytics_revenue_by_plan(
  p_branch uuid DEFAULT NULL,
  p_from   date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date - 365,
  p_to     date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  p_limit  integer DEFAULT 5
)
RETURNS TABLE(plan_name text, revenue numeric, txn_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT has_capability(auth.uid(), 'view_financials') THEN
    RAISE EXCEPTION 'forbidden: view_financials required';
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
      COALESCE(mp.name, 'Other / POS') AS plan_name,
      paid.amount * (ii.unit_price * ii.quantity)::numeric
        / NULLIF(SUM(ii.unit_price * ii.quantity) OVER (PARTITION BY paid.id), 0) AS allocated
    FROM paid
    JOIN public.invoice_items ii ON ii.invoice_id = paid.invoice_id
    LEFT JOIN public.memberships m ON ii.reference_type = 'membership' AND ii.reference_id = m.id
    LEFT JOIN public.membership_plans mp ON m.plan_id = mp.id
  )
  SELECT plan_name,
         ROUND(SUM(allocated)::numeric, 2) AS revenue,
         COUNT(*)::int AS txn_count
  FROM alloc
  GROUP BY plan_name
  ORDER BY revenue DESC NULLS LAST
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.analytics_revenue_by_plan(uuid, date, date, integer) TO authenticated;
