
ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS attempt smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_retried_at timestamptz;

CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_status_idx
  ON public.campaign_recipients (campaign_id, status);

CREATE INDEX IF NOT EXISTS communication_logs_dedupe_key_prefix_idx
  ON public.communication_logs (dedupe_key text_pattern_ops);
