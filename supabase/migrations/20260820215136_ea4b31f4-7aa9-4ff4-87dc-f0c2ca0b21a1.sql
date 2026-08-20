-- 1. Schedule automatic purges for pg_cron logs and net extension logs
-- purge-cron-logs: Keep 7 days of job history
SELECT cron.schedule('purge-cron-logs', '0 0 * * *', $$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days'$$);

-- purge-net-logs: Keep 7 days of HTTP response logs
SELECT cron.schedule('purge-net-logs', '5 0 * * *', $$DELETE FROM net._http_response WHERE created_at < now() - interval '7 days'$$);

-- 2. Audit current public table sizes one last time to ensure maintenance is scheduled for high-growth tables
SELECT
    relname AS table_name,
    pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
    n_live_tup AS row_count
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;