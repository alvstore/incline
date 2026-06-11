
-- Auto-resolve matched WhatsApp brain heartbeat pairs in error_logs.
-- Heartbeats are emitted by supabase/functions/whatsapp-webhook (v6.5.0):
-- a `brain_start <phone>` row before the AI runs, and a `brain_end <phone>`
-- row after success. Only an UNMATCHED start (no end within ~90s) is a real
-- stalled-worker signal — matched pairs are pure telemetry and shouldn't
-- linger as "open" errors.

CREATE OR REPLACE FUNCTION public.auto_resolve_brain_heartbeat()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_msg_id text;
BEGIN
  IF NEW.source <> 'whatsapp_brain' OR COALESCE(NEW.severity,'') <> 'info' THEN
    RETURN NEW;
  END IF;

  v_msg_id := NEW.context->>'message_id';
  IF v_msg_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- When the matching end arrives, close the open start row (if any)…
  IF NEW.error_message LIKE 'brain_end %' THEN
    UPDATE public.error_logs
       SET status = 'resolved', resolved_at = now()
     WHERE source = 'whatsapp_brain'
       AND severity = 'info'
       AND status = 'open'
       AND error_message LIKE 'brain_start %'
       AND context->>'message_id' = v_msg_id;

    -- …and resolve this end row itself so it doesn't sit in the open list.
    NEW.status := 'resolved';
    NEW.resolved_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_auto_resolve_brain_heartbeat ON public.error_logs;
CREATE TRIGGER tg_auto_resolve_brain_heartbeat
BEFORE INSERT OR UPDATE ON public.error_logs
FOR EACH ROW
EXECUTE FUNCTION public.auto_resolve_brain_heartbeat();

-- Backfill: resolve any existing matched heartbeat pairs.
WITH ends AS (
  SELECT context->>'message_id' AS mid
    FROM public.error_logs
   WHERE source = 'whatsapp_brain'
     AND severity = 'info'
     AND error_message LIKE 'brain_end %'
     AND context ? 'message_id'
)
UPDATE public.error_logs el
   SET status = 'resolved', resolved_at = now()
  FROM ends
 WHERE el.source = 'whatsapp_brain'
   AND el.severity = 'info'
   AND el.status = 'open'
   AND el.context->>'message_id' = ends.mid;
