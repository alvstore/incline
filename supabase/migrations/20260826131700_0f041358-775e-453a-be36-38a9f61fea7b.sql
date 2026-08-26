-- ─────────────────────────────────────────────────────────────
-- Phase 2/6/9 foundation: recipient lifecycle + authoritative stats
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS communication_log_id uuid,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS error_class text,
  ADD COLUMN IF NOT EXISTS last_meta_error_code text,
  ADD COLUMN IF NOT EXISTS last_meta_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_blocked_until timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS unknown_at timestamptz;

ALTER TABLE public.campaign_recipients DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;
ALTER TABLE public.campaign_recipients ADD CONSTRAINT campaign_recipients_status_check
  CHECK (status = ANY (ARRAY[
    'pending','dispatching','queued','submitted','sent','delivered','read',
    'failed','suppressed','skipped','cancelled','unknown'
  ]));

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS pending_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS queued_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suppressed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unknown_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_check
  CHECK (status = ANY (ARRAY[
    'draft','scheduled','materializing','sending','sent','failed','paused',
    'cancelled','pending_template_approval'
  ]));

-- WhatsApp provider-transmission evidence (Phase 1)
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS provider_ack_state text,
  ADD COLUMN IF NOT EXISTS provider_attempted_at timestamptz;

-- ── Historical duplicates: keep every row, flag the weaker one ──
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY campaign_id, source_type, source_ref_id
           ORDER BY CASE status
             WHEN 'read' THEN 6 WHEN 'delivered' THEN 5 WHEN 'sent' THEN 4
             WHEN 'submitted' THEN 3 WHEN 'queued' THEN 2 WHEN 'failed' THEN 1
             ELSE 0 END DESC, created_at ASC
         ) AS rn
  FROM public.campaign_recipients
  WHERE source_ref_id IS NOT NULL
)
UPDATE public.campaign_recipients cr
SET superseded = true
FROM ranked
WHERE cr.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_logical_uniq
  ON public.campaign_recipients (campaign_id, source_type, source_ref_id)
  WHERE superseded = false AND source_ref_id IS NOT NULL;

DROP INDEX IF EXISTS public.campaign_recipients_campaign_status_idx;

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_log
  ON public.campaign_recipients (communication_log_id)
  WHERE communication_log_id IS NOT NULL;

-- ── Rank helper ──
CREATE OR REPLACE FUNCTION public.campaign_recipient_rank(_status text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE lower(coalesce(_status,''))
    WHEN 'pending' THEN 0
    WHEN 'dispatching' THEN 1
    WHEN 'queued' THEN 2
    WHEN 'submitted' THEN 3
    WHEN 'sent' THEN 4
    WHEN 'delivered' THEN 5
    WHEN 'read' THEN 6
    WHEN 'unknown' THEN 50
    WHEN 'failed' THEN 90
    WHEN 'suppressed' THEN 90
    WHEN 'skipped' THEN 90
    WHEN 'cancelled' THEN 90
    ELSE 0 END;
$$;

-- ── Authoritative, monotonic recipient transition (Phase 2) ──
CREATE OR REPLACE FUNCTION public.apply_campaign_recipient_status(
  p_recipient_id uuid,
  p_status       text,
  p_error        text DEFAULT NULL,
  p_error_class  text DEFAULT NULL,
  p_meta_code    text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_provider_route text DEFAULT NULL,
  p_log_id       uuid DEFAULT NULL,
  p_blocked_until timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.campaign_recipients%ROWTYPE;
  v_cur int; v_new int; v_advance boolean; v_now timestamptz := now();
BEGIN
  SELECT * INTO v_row FROM public.campaign_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'recipient_not_found'); END IF;

  v_cur := public.campaign_recipient_rank(v_row.status);
  v_new := public.campaign_recipient_rank(p_status);

  -- Forward progress only. Delivery failures may override in-flight states but
  -- never a confirmed delivered/read. `unknown` never overwrites a confirmed
  -- provider outcome and never counts as success.
  v_advance := CASE
    WHEN p_status = v_row.status THEN false
    WHEN p_status IN ('failed','suppressed','skipped','cancelled')
      THEN v_row.status NOT IN ('delivered','read')
    WHEN p_status = 'unknown'
      THEN v_cur <= public.campaign_recipient_rank('submitted')
    ELSE v_new > v_cur
  END;

  UPDATE public.campaign_recipients SET
    status = CASE WHEN v_advance THEN p_status ELSE status END,
    error  = COALESCE(p_error, error),
    error_class = COALESCE(p_error_class, error_class),
    last_meta_error_code = COALESCE(p_meta_code, last_meta_error_code),
    last_meta_error_at = CASE WHEN p_meta_code IS NOT NULL THEN v_now ELSE last_meta_error_at END,
    marketing_blocked_until = COALESCE(p_blocked_until, marketing_blocked_until),
    provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
    provider_route = COALESCE(p_provider_route, provider_route),
    communication_log_id = COALESCE(p_log_id, communication_log_id),
    submitted_at = CASE WHEN p_status = 'submitted' AND submitted_at IS NULL THEN v_now ELSE submitted_at END,
    dispatched_at = CASE WHEN p_status IN ('submitted','sent') AND dispatched_at IS NULL THEN v_now ELSE dispatched_at END,
    delivered_at = CASE WHEN p_status = 'delivered' AND delivered_at IS NULL THEN v_now ELSE delivered_at END,
    read_at = CASE WHEN p_status = 'read' AND read_at IS NULL THEN v_now ELSE read_at END,
    unknown_at = CASE WHEN p_status = 'unknown' AND unknown_at IS NULL THEN v_now ELSE unknown_at END
  WHERE id = p_recipient_id;

  RETURN jsonb_build_object('ok', true, 'advanced', v_advance, 'from', v_row.status, 'to',
    CASE WHEN v_advance THEN p_status ELSE v_row.status END);
END;
$$;

-- ── Campaign counters recomputed from recipient rows (Phase 6) ──
CREATE OR REPLACE FUNCTION public.refresh_campaign_stats(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  WITH s AS (
    SELECT
      count(*)                                                   AS total,
      count(*) FILTER (WHERE status = 'pending')                 AS pending,
      count(*) FILTER (WHERE status = 'dispatching')             AS dispatching,
      count(*) FILTER (WHERE status = 'queued')                  AS queued,
      count(*) FILTER (WHERE status = 'submitted')               AS submitted,
      count(*) FILTER (WHERE status IN ('sent','delivered','read')) AS sent,
      count(*) FILTER (WHERE status IN ('delivered','read'))     AS delivered,
      count(*) FILTER (WHERE status = 'read')                    AS readc,
      count(*) FILTER (WHERE status = 'failed')                  AS failed,
      count(*) FILTER (WHERE status = 'suppressed')              AS suppressed,
      count(*) FILTER (WHERE status = 'skipped')                 AS skipped,
      count(*) FILTER (WHERE status = 'cancelled')               AS cancelled,
      count(*) FILTER (WHERE status = 'unknown')                 AS unknownc
    FROM public.campaign_recipients
    WHERE campaign_id = p_campaign_id AND superseded = false
  )
  UPDATE public.campaigns c SET
    recipients_count = s.total,
    success_count    = s.sent,
    delivered_count  = s.delivered,
    read_count       = s.readc,
    failure_count    = s.failed,
    pending_count    = s.pending + s.dispatching,
    queued_count     = s.queued,
    submitted_count  = s.submitted,
    suppressed_count = s.suppressed,
    skipped_count    = s.skipped,
    cancelled_count  = s.cancelled,
    unknown_count    = s.unknownc
  FROM s
  WHERE c.id = p_campaign_id
  RETURNING jsonb_build_object(
    'total', s.total, 'pending', s.pending + s.dispatching, 'queued', s.queued,
    'submitted', s.submitted, 'sent', s.sent, 'delivered', s.delivered,
    'read', s.readc, 'failed', s.failed, 'suppressed', s.suppressed,
    'skipped', s.skipped, 'cancelled', s.cancelled, 'unknown', s.unknownc
  ) INTO v;

  RETURN COALESCE(v, jsonb_build_object('ok', false, 'reason', 'campaign_not_found'));
END;
$$;

REVOKE ALL ON FUNCTION public.apply_campaign_recipient_status(uuid,text,text,text,text,text,text,uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_campaign_recipient_status(uuid,text,text,text,text,text,text,uuid,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.refresh_campaign_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_campaign_stats(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.campaign_recipient_rank(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_recipient_rank(text) TO authenticated, service_role;

-- Backfill every campaign's counters from its recipient rows.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.campaigns LOOP
    PERFORM public.refresh_campaign_stats(r.id);
  END LOOP;
END $$;