-- 1. Alias table: allow matching by numeric MIPS id and by name
ALTER TABLE public.mips_person_aliases
  ADD COLUMN IF NOT EXISTS person_id text;

ALTER TABLE public.mips_person_aliases ALTER COLUMN person_code DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mips_person_aliases_person_id_key
  ON public.mips_person_aliases (person_id) WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS mips_person_aliases_name_idx
  ON public.mips_person_aliases (lower(btrim(person_name)));

CREATE OR REPLACE FUNCTION public.resolve_mips_person_alias(_person_code text, _person_name text DEFAULT NULL)
RETURNS TABLE(target_type text, target_id uuid, user_id uuid, branch_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  a public.mips_person_aliases%ROWTYPE;
  v_code text := NULLIF(btrim(COALESCE(_person_code, '')), '');
  v_name text := NULLIF(btrim(COALESCE(_person_name, '')), '');
BEGIN
  IF v_code IS NULL AND v_name IS NULL THEN
    RETURN;
  END IF;

  -- Tier 1: exact person_code
  IF v_code IS NOT NULL THEN
    SELECT * INTO a FROM public.mips_person_aliases
     WHERE person_code IS NOT NULL AND upper(person_code) = upper(v_code) LIMIT 1;
  END IF;

  -- Tier 2: numeric / raw MIPS person id
  IF a.id IS NULL AND v_code IS NOT NULL THEN
    SELECT * INTO a FROM public.mips_person_aliases
     WHERE person_id IS NOT NULL AND person_id = v_code LIMIT 1;
  END IF;

  -- Tier 3: person name recorded on the alias
  IF a.id IS NULL AND v_name IS NOT NULL THEN
    SELECT * INTO a FROM public.mips_person_aliases
     WHERE person_name IS NOT NULL
       AND lower(btrim(person_name)) = lower(v_name)
     LIMIT 1;
  END IF;

  IF a.id IS NULL THEN
    RETURN;
  END IF;

  IF a.target_type = 'member' THEN
    RETURN QUERY SELECT 'member'::text, m.id, m.user_id, m.branch_id
      FROM public.members m WHERE m.id = a.target_id;
  ELSIF a.target_type = 'employee' THEN
    RETURN QUERY SELECT 'employee'::text, e.id, e.user_id, e.branch_id
      FROM public.employees e WHERE e.id = a.target_id;
  ELSE
    RETURN QUERY SELECT 'trainer'::text, t.id, t.user_id, t.branch_id
      FROM public.trainers t WHERE t.id = a.target_id;
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_mips_person_alias(text, text) TO authenticated, service_role;

-- 2. Overpay guard on payments
CREATE OR REPLACE FUNCTION public.tg_payments_block_overpay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric;
  v_paid numeric;
BEGIN
  IF NEW.invoice_id IS NULL OR NEW.status <> 'completed'::public.payment_status THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.notes, '') ILIKE '%[advance]%' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(total_amount, 0) INTO v_total FROM public.invoices WHERE id = NEW.invoice_id;
  IF v_total IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.payments
  WHERE invoice_id = NEW.invoice_id
    AND status = 'completed'::public.payment_status
    AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF v_paid + COALESCE(NEW.amount, 0) > v_total + 0.01 THEN
    RAISE EXCEPTION 'Payment of % exceeds the remaining balance on this invoice (total %, already paid %). If this is intentional, record it as an advance.',
      NEW.amount, v_total, v_paid;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS payments_block_overpay ON public.payments;
CREATE TRIGGER payments_block_overpay
BEFORE INSERT OR UPDATE OF amount, status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_block_overpay();

-- 3. settle_payment: adopt a matching manual payment instead of duplicating
CREATE OR REPLACE FUNCTION public.settle_payment_adopt_manual(
  p_invoice_id uuid,
  p_amount numeric,
  p_gateway_payment_id text,
  p_payment_source text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF p_gateway_payment_id IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO v_id
  FROM public.payments
  WHERE invoice_id = p_invoice_id
    AND status = 'completed'::public.payment_status
    AND transaction_id IS NULL
    AND abs(COALESCE(amount, 0) - p_amount) < 0.01
    AND created_at > now() - interval '24 hours'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public.payments
  SET transaction_id = p_gateway_payment_id,
      payment_source = COALESCE(p_payment_source, payment_source),
      lifecycle_metadata = COALESCE(lifecycle_metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb)
        || jsonb_build_object('adopted_manual_entry', true, 'gateway_payment_id', p_gateway_payment_id),
      notes = COALESCE(notes, '') || ' | matched to gateway payment ' || p_gateway_payment_id
  WHERE id = v_id;

  RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.settle_payment_adopt_manual(uuid, numeric, text, text, jsonb) TO service_role;