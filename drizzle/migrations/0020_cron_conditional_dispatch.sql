-- 0020 — Cron pollers only wake a function when there is work.
-- Five pg_cron jobs (whatsapp 2 min, rcs 2 min, campaign-stats 5 min, razorpay 5 min,
-- automation-brain 5 min) spun up an edge function on every tick, 24x7, even when
-- their work queues were empty. Each job's existing command is kept byte-for-byte
-- (it embeds its own auth headers) and simply gated with a cheap indexed EXISTS, so
-- cadence is unchanged whenever work is pending and no-op ticks cost nothing.

-- Index backing the Razorpay gate (payment_transactions has no status index).
CREATE INDEX IF NOT EXISTS idx_payment_transactions_open_razorpay_orders
  ON public.payment_transactions (created_at DESC)
  WHERE gateway = 'razorpay' AND source = 'order'
    AND status IN ('created','pending','authorized');

-- Index backing the campaign-stats gate.
CREATE INDEX IF NOT EXISTS idx_campaigns_recent_by_status
  ON public.campaigns (status, created_at DESC);

-- Index backing the automation-brain gate.
CREATE INDEX IF NOT EXISTS idx_automation_rules_due
  ON public.automation_rules (next_run_at)
  WHERE is_active = true;

DO $do$
DECLARE
  j record;
  c text;
  gate text;
BEGIN
  FOR j IN SELECT jobid, jobname, command FROM cron.job
           WHERE jobname IN (
             'reconcile-whatsapp-pending-every-2min',
             'reconcile-rcs-pending-every-2min',
             'reconcile-campaign-stats-every-2min',
             'reconcile-razorpay-links-every-5min',
             'automation-brain-tick'
           )
  LOOP
    IF j.command ~* 'WHERE\s+EXISTS' THEN
      CONTINUE; -- already gated
    END IF;

    gate := CASE j.jobname
      WHEN 'reconcile-whatsapp-pending-every-2min' THEN
        -- Candidates, parkAmbiguous and expireStale all require exactly this predicate
        -- (partial index idx_whatsapp_messages_pending_outbound).
        $g$SELECT 1 FROM public.whatsapp_messages
            WHERE direction = 'outbound' AND status = 'pending' AND whatsapp_message_id IS NULL$g$
      WHEN 'reconcile-rcs-pending-every-2min' THEN
        -- Telinfy DLR polling window is 24h; 25h keeps the gate a strict superset.
        $g$SELECT 1 FROM public.communication_logs
            WHERE channel = 'rcs' AND delivery_status = 'sent' AND delivered_at IS NULL
              AND provider_record_id IS NOT NULL
              AND created_at >= now() - interval '25 hours'$g$
      WHEN 'reconcile-campaign-stats-every-2min' THEN
        $g$SELECT 1 FROM public.campaigns
            WHERE status IN ('sending','sent','failed')
              AND created_at >= now() - interval '24 hours'$g$
      WHEN 'reconcile-razorpay-links-every-5min' THEN
        $g$SELECT 1 FROM public.payment_transactions
            WHERE gateway = 'razorpay' AND source = 'order'
              AND status IN ('created','pending','authorized')
              AND created_at >= now() - interval '14 days'$g$
      WHEN 'automation-brain-tick' THEN
        $g$SELECT 1 FROM public.automation_rules
            WHERE is_active = true AND next_run_at <= now()$g$
    END;

    IF gate IS NULL THEN
      CONTINUE;
    END IF;

    c := j.command;
    c := regexp_replace(c, '^\s*select\s+', 'SELECT ', 'i');     -- normalise leading keyword
    c := regexp_replace(c, '\s+as\s+request_id\s*;?\s*$', '', 'i'); -- drop trailing alias
    c := regexp_replace(c, ';\s*$', '');                          -- drop trailing semicolon
    c := c || E'\n  WHERE EXISTS (' || gate || E');\n';

    PERFORM cron.alter_job(job_id := j.jobid, command := c);
    RAISE NOTICE 'gated cron job % (%)', j.jobname, j.jobid;
  END LOOP;
END
$do$;