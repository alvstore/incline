-- Create a maintenance function to keep logs lean
CREATE OR REPLACE FUNCTION public.maintain_log_sizes()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Retention policies
    DELETE FROM public.audit_logs WHERE created_at < now() - interval '30 days';
    DELETE FROM public.automation_runs WHERE started_at < now() - interval '15 days';
    DELETE FROM public.communication_logs WHERE created_at < now() - interval '30 days';
    DELETE FROM public.communication_retry_queue WHERE created_at < now() - interval '7 days' AND status IN ('completed', 'failed_permanent');
    DELETE FROM public.webhook_failures WHERE created_at < now() - interval '15 days';
    DELETE FROM public.system_health_pings WHERE created_at < now() - interval '7 days';
END;
$$;

-- Schedule the maintenance job
SELECT cron.schedule('daily-log-maintenance', '30 2 * * *', 'SELECT public.maintain_log_sizes()');

GRANT EXECUTE ON FUNCTION public.maintain_log_sizes() TO service_role;
