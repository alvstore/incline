-- Atomic pull-and-lock for the next N pending recipients of a campaign.
-- Flips status pending → dispatching in the same statement so no other
-- chunk isolate can grab the same row. Bumps attempt count so a stalled
-- row eventually hits max_attempts and gets failed instead of retried forever.
CREATE OR REPLACE FUNCTION public.claim_broadcast_batch(
  p_campaign_id uuid,
  p_limit int DEFAULT 20
)
RETURNS SETOF public.campaign_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.campaign_recipients cr
  SET status = 'dispatching',
      attempt = COALESCE(cr.attempt, 0) + 1,
      last_retried_at = now()
  WHERE cr.id IN (
    SELECT id FROM public.campaign_recipients
    WHERE campaign_id = p_campaign_id
      AND status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING cr.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_broadcast_batch(uuid, int) TO service_role;

-- Fast lookup of remaining work per campaign, independent of table size.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_pending
  ON public.campaign_recipients (campaign_id)
  WHERE status = 'pending';

-- Also speed up the "is anything still in flight" watchdog check.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_dispatching
  ON public.campaign_recipients (campaign_id)
  WHERE status = 'dispatching';