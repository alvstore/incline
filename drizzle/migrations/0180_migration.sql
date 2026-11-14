-- Renewal Center v2 replaced the all-time funnel with period-scoped queue counts.
DROP FUNCTION IF EXISTS public.renewal_funnel(uuid, integer);