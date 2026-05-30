
-- Communication retry queue: dedupe trigger to stop runaway loops
-- Prevents inserting a new pending row when an active one exists for the same
-- (recipient, type, content) — instead reuses/refreshes the existing row.

CREATE OR REPLACE FUNCTION public.fn_comm_retry_queue_dedupe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_existing_count integer;
BEGIN
  -- Only dedupe pending/processing rows
  IF NEW.status NOT IN ('pending', 'processing') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing_id
    FROM public.communication_retry_queue
   WHERE recipient = NEW.recipient
     AND type = NEW.type
     AND md5(coalesce(content,'')) = md5(coalesce(NEW.content,''))
     AND status IN ('pending', 'processing')
     AND id <> coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
   LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    -- Bump retry_count + last_error on existing row instead of creating dupe
    UPDATE public.communication_retry_queue
       SET retry_count = retry_count + 1,
           last_error = coalesce(NEW.last_error, last_error),
           next_retry_at = greatest(now() + interval '5 minutes', next_retry_at),
           updated_at = now()
     WHERE id = v_existing_id;
    -- Block the duplicate insert silently
    RETURN NULL;
  END IF;

  -- Hard ceiling: never allow more than 50 active rows per recipient — safety net
  SELECT count(*) INTO v_existing_count
    FROM public.communication_retry_queue
   WHERE recipient = NEW.recipient
     AND status IN ('pending', 'processing');

  IF v_existing_count >= 50 THEN
    RAISE WARNING 'comm_retry_queue: recipient % has % active rows — blocking insert (runaway protection)', NEW.recipient, v_existing_count;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_comm_retry_queue_dedupe ON public.communication_retry_queue;
CREATE TRIGGER tg_comm_retry_queue_dedupe
  BEFORE INSERT ON public.communication_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.fn_comm_retry_queue_dedupe();

-- One-shot cleanup: mark long-stuck pending rows as exhausted
UPDATE public.communication_retry_queue
   SET status = 'exhausted',
       last_error = coalesce(last_error, '') || ' [auto-exhausted: stuck >7d]',
       updated_at = now()
 WHERE status IN ('pending','processing')
   AND created_at < now() - interval '7 days';

-- Cap retry_count >= max_retries as exhausted
UPDATE public.communication_retry_queue
   SET status = 'exhausted', updated_at = now()
 WHERE status IN ('pending','processing')
   AND retry_count >= max_retries;
