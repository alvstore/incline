ALTER TABLE public.communication_retry_queue DROP CONSTRAINT IF EXISTS communication_retry_queue_status_check;
ALTER TABLE public.communication_retry_queue ADD CONSTRAINT communication_retry_queue_status_check
  CHECK (status = ANY (ARRAY[
    'pending','processing','succeeded','exhausted','cancelled',
    'awaiting_confirmation','terminal','unknown'
  ]));

CREATE INDEX IF NOT EXISTS idx_retry_queue_awaiting
  ON public.communication_retry_queue (updated_at)
  WHERE status = 'awaiting_confirmation';