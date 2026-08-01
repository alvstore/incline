-- 1. New membership status
ALTER TYPE public.membership_status ADD VALUE IF NOT EXISTS 'upgraded';

-- 2. Upgrade lineage columns
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS upgraded_from_membership_id uuid REFERENCES public.memberships(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS upgrade_credit_amount numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_memberships_upgraded_from
  ON public.memberships(upgraded_from_membership_id)
  WHERE upgraded_from_membership_id IS NOT NULL;

-- 3. Shared calendar-aware end-date helper (mirrors src/lib/memberships/duration.ts)
CREATE OR REPLACE FUNCTION public.membership_end_date(p_start date, p_duration_days integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE COALESCE(p_duration_days, 0)
    WHEN 30  THEN (p_start + interval '1 month'  - interval '1 day')::date
    WHEN 90  THEN (p_start + interval '3 months' - interval '1 day')::date
    WHEN 180 THEN (p_start + interval '6 months' - interval '1 day')::date
    WHEN 365 THEN (p_start + interval '1 year'   - interval '1 day')::date
    ELSE (p_start + make_interval(days => GREATEST(COALESCE(p_duration_days, 1) - 1, 0)))::date
  END;
$$;

GRANT EXECUTE ON FUNCTION public.membership_end_date(date, integer) TO authenticated, service_role;