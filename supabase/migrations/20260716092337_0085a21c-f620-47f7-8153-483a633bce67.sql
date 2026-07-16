UPDATE public.campaigns
SET status='scheduled',
    scheduled_at = now() + interval '30 seconds',
    sent_at = NULL,
    success_count = 0,
    failure_count = 0,
    recipients_count = 0,
    last_run_error = NULL,
    last_progress_at = NULL
WHERE id='264bd41f-4d46-4bfc-af98-36fc926bfd1f';