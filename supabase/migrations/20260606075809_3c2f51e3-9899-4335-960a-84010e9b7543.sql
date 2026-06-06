UPDATE public.communication_logs
SET status = 'failed',
    delivery_status = 'failed',
    error_message = COALESCE(error_message,'') ||
      ' [auto-repaired: stuck in sending due to delivery_metadata NOT NULL bug — dispatch-communication v1.17.0]',
    attempt_count = GREATEST(attempt_count, 1)
WHERE delivery_status = 'sending'
  AND created_at < now() - interval '5 minutes';