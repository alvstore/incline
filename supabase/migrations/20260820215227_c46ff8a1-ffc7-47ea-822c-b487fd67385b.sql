-- Fixed maintenance function with correct column names
CREATE OR REPLACE FUNCTION public.maintain_log_sizes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Retention policies (aggressive for high-volume logs)
    
    -- Webhook failures: keep last 3 days
    DELETE FROM public.webhook_failures WHERE created_at < now() - interval '3 days';
    
    -- Automation runs: keep last 5 days
    DELETE FROM public.automation_runs WHERE started_at < now() - interval '5 days';
    
    -- Communication logs: keep 15 days
    DELETE FROM public.communication_logs WHERE created_at < now() - interval '15 days';
    
    -- Retry queue: Keep recent successes (last 2 days)
    DELETE FROM public.communication_retry_queue 
    WHERE created_at < now() - interval '2 days' 
    AND status IN ('completed', 'failed_permanent');
    
    -- System health pings: Keep only 24 hours of history (observed_at)
    DELETE FROM public.system_health_pings WHERE observed_at < now() - interval '1 day';
    
    -- Audit logs: Keep 30 days
    DELETE FROM public.audit_logs WHERE created_at < now() - interval '30 days';

    -- Notifications: Keep 15 days
    DELETE FROM public.notifications WHERE created_at < now() - interval '15 days';
END;
$$;

-- Increase cron frequency for log maintenance to every 6 hours
SELECT cron.schedule('daily-log-maintenance', '0 */6 * * *', 'SELECT public.maintain_log_sizes()');

-- Run once now to reclaim space
SELECT public.maintain_log_sizes();
