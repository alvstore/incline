ALTER TABLE public.scan_report_deliveries
  ADD COLUMN IF NOT EXISTS original_pdf_path text,
  ADD COLUMN IF NOT EXISTS pdf_source text NOT NULL DEFAULT 'generated_fallback',
  ADD COLUMN IF NOT EXISTS email_communication_log_id uuid REFERENCES public.communication_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_communication_log_id uuid REFERENCES public.communication_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_provider_message_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_read_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_scan_report_deliveries_wa_log
  ON public.scan_report_deliveries (whatsapp_communication_log_id)
  WHERE whatsapp_communication_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_report_deliveries_wa_provider
  ON public.scan_report_deliveries (whatsapp_provider_message_id)
  WHERE whatsapp_provider_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_scan_report_delivery_from_communication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.type IS DISTINCT FROM 'whatsapp' THEN
    RETURN NEW;
  END IF;

  v_status := lower(coalesce(NEW.delivery_status::text, NEW.status::text, 'pending'));
  IF v_status NOT IN ('pending','queued','scheduled','sent','delivered','read','replied','failed','bounced','suppressed','deduped') THEN
    v_status := 'pending';
  END IF;

  UPDATE public.scan_report_deliveries
  SET whatsapp_status = v_status,
      whatsapp_error = CASE WHEN v_status IN ('failed','bounced','suppressed') THEN NEW.error_message ELSE NULL END,
      whatsapp_provider_message_id = coalesce(NEW.provider_message_id, whatsapp_provider_message_id),
      whatsapp_accepted_at = CASE WHEN v_status IN ('sent','delivered','read','replied') THEN coalesce(whatsapp_accepted_at, NEW.sent_at, now()) ELSE whatsapp_accepted_at END,
      whatsapp_delivered_at = CASE WHEN v_status IN ('delivered','read','replied') THEN coalesce(NEW.delivered_at, whatsapp_delivered_at, now()) ELSE whatsapp_delivered_at END,
      whatsapp_read_at = CASE WHEN v_status IN ('read','replied') THEN coalesce(NEW.read_at, whatsapp_read_at, now()) ELSE whatsapp_read_at END,
      updated_at = now()
  WHERE whatsapp_communication_log_id = NEW.id
     OR (NEW.provider_message_id IS NOT NULL AND whatsapp_provider_message_id = NEW.provider_message_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_sync_scan_report_delivery_from_communication ON public.communication_logs;
CREATE TRIGGER tg_sync_scan_report_delivery_from_communication
AFTER INSERT OR UPDATE OF status, delivery_status, provider_message_id, error_message, sent_at, delivered_at, read_at
ON public.communication_logs
FOR EACH ROW
EXECUTE FUNCTION public.sync_scan_report_delivery_from_communication();

GRANT EXECUTE ON FUNCTION public.sync_scan_report_delivery_from_communication() TO service_role;