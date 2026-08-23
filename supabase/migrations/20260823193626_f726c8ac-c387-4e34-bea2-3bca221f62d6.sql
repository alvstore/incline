CREATE OR REPLACE FUNCTION public.claim_broadcast_batch(p_campaign_id uuid, p_limit integer DEFAULT 20)
 RETURNS SETOF campaign_recipients
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- v2: also reclaim rows stuck in 'dispatching' for >5 minutes. A chunk
  -- isolate that dies mid-flight used to leave those rows unclaimable
  -- forever, which stalled the whole campaign at N/total.
  RETURN QUERY
  UPDATE public.campaign_recipients cr
  SET status = 'dispatching',
      attempt = COALESCE(cr.attempt, 0) + 1,
      last_retried_at = now()
  WHERE cr.id IN (
    SELECT id FROM public.campaign_recipients
    WHERE campaign_id = p_campaign_id
      AND (
        status = 'pending'
        OR (status = 'dispatching'
            AND COALESCE(last_retried_at, created_at) < now() - interval '5 minutes'
            AND COALESCE(attempt, 0) <= 3)
      )
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING cr.*;
END;
$function$;