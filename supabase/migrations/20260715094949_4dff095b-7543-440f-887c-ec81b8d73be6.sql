UPDATE public.communication_logs
SET delivery_status = 'suppressed',
    status = 'suppressed',
    delivery_metadata = COALESCE(delivery_metadata, '{}'::jsonb)
                        || jsonb_build_object('manual_backfill', 'pre_flight_bug_fixed_v3_3_0',
                                              'backfilled_at', now()::text)
WHERE recipient = '919887601200'
  AND category = 'new_lead'
  AND delivery_status = 'failed'
  AND error_message LIKE '132018: template_param_empty%';

UPDATE public.communication_retry_queue
SET status = 'cancelled',
    last_error = 'cancelled_by_backfill_v3_3_0'
WHERE status IN ('pending', 'scheduled', 'queued')
  AND recipient = '919887601200'
  AND (last_error LIKE '%template_param_empty%' OR last_error LIKE '%132018%');