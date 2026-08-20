-- Truncating is faster and bypasses individual row deletion timeouts
TRUNCATE TABLE cron.job_run_details;
TRUNCATE TABLE net._http_response;
