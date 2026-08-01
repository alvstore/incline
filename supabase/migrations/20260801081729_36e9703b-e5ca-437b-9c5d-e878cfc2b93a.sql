ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS gateway_order_id text,
  ADD COLUMN IF NOT EXISTS gateway_fee numeric(12,2),
  ADD COLUMN IF NOT EXISTS gateway_tax numeric(12,2),
  ADD COLUMN IF NOT EXISTS net_settlement_amount numeric(12,2);

ALTER TABLE public.payments
  ADD CONSTRAINT payments_gateway_fee_nonnegative CHECK (gateway_fee IS NULL OR gateway_fee >= 0),
  ADD CONSTRAINT payments_gateway_tax_nonnegative CHECK (gateway_tax IS NULL OR gateway_tax >= 0),
  ADD CONSTRAINT payments_net_settlement_nonnegative CHECK (net_settlement_amount IS NULL OR net_settlement_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_payments_gateway_order_id
  ON public.payments (gateway_order_id)
  WHERE gateway_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_gateway_payment_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_captured_at timestamptz;
  v_fee numeric;
  v_tax numeric;
  v_net numeric;
BEGIN
  IF NEW.lifecycle_metadata IS NULL THEN
    NEW.lifecycle_metadata := '{}'::jsonb;
  END IF;

  BEGIN
    v_captured_at := NULLIF(NEW.lifecycle_metadata->>'gateway_captured_at', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
    v_captured_at := NULL;
  END;

  BEGIN
    v_fee := NULLIF(NEW.lifecycle_metadata->>'gateway_fee', '')::numeric;
    v_tax := NULLIF(NEW.lifecycle_metadata->>'gateway_tax', '')::numeric;
    v_net := NULLIF(NEW.lifecycle_metadata->>'net_settlement_amount', '')::numeric;
  EXCEPTION WHEN invalid_text_representation THEN
    v_fee := NULL;
    v_tax := NULL;
    v_net := NULL;
  END;

  NEW.payment_date := COALESCE(v_captured_at, NEW.payment_date, now());
  NEW.settled_at := COALESCE(v_captured_at, NEW.settled_at, now());
  NEW.gateway_order_id := COALESCE(NEW.gateway_order_id, NULLIF(NEW.lifecycle_metadata->>'gateway_order_id', ''));
  NEW.gateway_fee := COALESCE(NEW.gateway_fee, v_fee);
  NEW.gateway_tax := COALESCE(NEW.gateway_tax, v_tax);
  NEW.net_settlement_amount := COALESCE(NEW.net_settlement_amount, v_net,
    CASE WHEN v_fee IS NOT NULL OR v_tax IS NOT NULL
      THEN GREATEST(0, NEW.amount - COALESCE(v_fee, 0) - COALESCE(v_tax, 0))
      ELSE NULL
    END);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_apply_gateway_payment_metadata ON public.payments;
CREATE TRIGGER tg_apply_gateway_payment_metadata
BEFORE INSERT OR UPDATE OF lifecycle_metadata ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.apply_gateway_payment_metadata();

ALTER TABLE public.mips_sync_attempts
  ADD COLUMN IF NOT EXISTS delivery_stage text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.mips_sync_attempts
  ADD CONSTRAINT mips_sync_attempts_delivery_stage_check
  CHECK (delivery_stage IN ('queued','server_face_ready','device_accepted','device_verified','failed'));

CREATE INDEX IF NOT EXISTS idx_mips_sync_attempts_unverified
  ON public.mips_sync_attempts (branch_id, device_id, updated_at DESC)
  WHERE delivery_stage IN ('queued','server_face_ready','device_accepted','failed');

UPDATE public.mips_sync_attempts
SET delivery_stage = CASE
  WHEN status = 'failed' THEN 'failed'
  WHEN status = 'success' AND operation = 'device_dispatch' THEN 'device_accepted'
  ELSE 'queued'
END
WHERE delivery_stage = 'queued';