CREATE OR REPLACE FUNCTION public.link_member_to_existing_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_email text;
  v_digits text;
  v_lead_id uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET status = 'converted'::lead_status,
           converted_member_id = NEW.id,
           converted_at = COALESCE(converted_at, now())
     WHERE id = NEW.lead_id
       AND (status <> 'converted'::lead_status OR converted_member_id IS DISTINCT FROM NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.phone, p.email INTO v_phone, v_email
    FROM public.profiles p WHERE p.id = NEW.user_id;

  v_digits := NULLIF(regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g'), '');
  IF v_digits IS NOT NULL AND length(v_digits) > 10 THEN
    v_digits := right(v_digits, 10);
  END IF;

  SELECT l.id INTO v_lead_id
    FROM public.leads l
   WHERE l.converted_member_id IS NULL
     AND (
           (v_digits IS NOT NULL AND right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10) = v_digits)
        OR (v_email IS NOT NULL AND l.email IS NOT NULL AND lower(l.email) = lower(v_email))
         )
   ORDER BY l.created_at DESC
   LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    NEW.lead_id := v_lead_id;
    UPDATE public.leads
       SET status = 'converted'::lead_status,
           converted_member_id = NEW.id,
           converted_at = COALESCE(converted_at, now())
     WHERE id = v_lead_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_link_member_to_existing_lead ON public.members;
CREATE TRIGGER tg_link_member_to_existing_lead
AFTER INSERT ON public.members
FOR EACH ROW EXECUTE FUNCTION public.link_member_to_existing_lead();

-- AFTER trigger cannot change NEW; use a separate statement-safe update helper
CREATE OR REPLACE FUNCTION public.link_member_to_existing_lead_after()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_email text;
  v_digits text;
  v_lead_id uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET status = 'converted'::lead_status,
           converted_member_id = NEW.id,
           converted_at = COALESCE(converted_at, now())
     WHERE id = NEW.lead_id
       AND (status <> 'converted'::lead_status OR converted_member_id IS DISTINCT FROM NEW.id);
    RETURN NULL;
  END IF;

  IF NEW.user_id IS NULL THEN RETURN NULL; END IF;

  SELECT p.phone, p.email INTO v_phone, v_email
    FROM public.profiles p WHERE p.id = NEW.user_id;

  v_digits := NULLIF(regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g'), '');
  IF v_digits IS NOT NULL AND length(v_digits) > 10 THEN
    v_digits := right(v_digits, 10);
  END IF;

  SELECT l.id INTO v_lead_id
    FROM public.leads l
   WHERE l.converted_member_id IS NULL
     AND (
           (v_digits IS NOT NULL AND right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10) = v_digits)
        OR (v_email IS NOT NULL AND l.email IS NOT NULL AND lower(l.email) = lower(v_email))
         )
   ORDER BY l.created_at DESC
   LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    UPDATE public.members SET lead_id = v_lead_id WHERE id = NEW.id AND lead_id IS NULL;
    UPDATE public.leads
       SET status = 'converted'::lead_status,
           converted_member_id = NEW.id,
           converted_at = COALESCE(converted_at, now())
     WHERE id = v_lead_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tg_link_member_to_existing_lead ON public.members;
CREATE TRIGGER tg_link_member_to_existing_lead
AFTER INSERT ON public.members
FOR EACH ROW EXECUTE FUNCTION public.link_member_to_existing_lead_after();

DROP FUNCTION IF EXISTS public.link_member_to_existing_lead();

-- Backfill existing members
WITH matched AS (
  SELECT DISTINCT ON (m.id) m.id AS member_id, l.id AS lead_id
    FROM public.members m
    JOIN public.profiles p ON p.id = m.user_id
    JOIN public.leads l
      ON l.converted_member_id IS NULL
     AND (
          right(regexp_replace(COALESCE(l.phone, ''), '\D', '', 'g'), 10)
            = right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10)
          AND length(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g')) >= 10
        OR (p.email IS NOT NULL AND l.email IS NOT NULL AND lower(l.email) = lower(p.email))
         )
   WHERE m.lead_id IS NULL
   ORDER BY m.id, l.created_at DESC
)
UPDATE public.members m
   SET lead_id = matched.lead_id
  FROM matched
 WHERE m.id = matched.member_id;

UPDATE public.leads l
   SET status = 'converted'::lead_status,
       converted_member_id = m.id,
       converted_at = COALESCE(l.converted_at, now())
  FROM public.members m
 WHERE m.lead_id = l.id
   AND (l.converted_member_id IS DISTINCT FROM m.id OR l.status <> 'converted'::lead_status);