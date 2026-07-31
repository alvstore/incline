CREATE OR REPLACE FUNCTION public.edit_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date timestamptz DEFAULT NULL,
  p_transaction_id text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_reason text DEFAULT 'Payment corrected'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_void jsonb;
  v_new jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only owners and admins can edit payments');
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be greater than zero');
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment not found');
  END IF;
  IF v_payment.invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only invoice-linked payments can be edited');
  END IF;

  v_void := public.void_payment(p_payment_id, 'Superseded by correction: ' || COALESCE(p_reason, 'Payment corrected'));
  IF NOT COALESCE((v_void->>'success')::boolean, false) THEN
    RETURN v_void;
  END IF;

  v_new := public.record_payment(
    v_payment.branch_id,
    v_payment.invoice_id,
    v_payment.member_id,
    p_amount,
    p_payment_method::text,
    COALESCE(p_payment_date, v_payment.payment_date),
    COALESCE(p_transaction_id, v_payment.transaction_id),
    COALESCE(p_notes, v_payment.notes),
    auth.uid(),
    v_payment.income_category_id
  );

  IF NOT COALESCE((v_new->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'PAYMENT_REPLACEMENT_FAILED: %', COALESCE(v_new->>'error', 'Unknown error');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'voided_payment_id', p_payment_id,
    'new_payment', v_new,
    'payment_id', v_new->>'payment_id'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.edit_payment(uuid,numeric,text,timestamptz,text,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.edit_payment(uuid,numeric,text,timestamptz,text,text,text) TO authenticated;

ALTER TABLE public.biometric_sync_queue
  ADD COLUMN IF NOT EXISTS person_type text;

UPDATE public.biometric_sync_queue q
SET person_type = CASE
  WHEN q.member_id IS NOT NULL THEN 'member'
  WHEN q.staff_id IS NOT NULL THEN 'employee'
  WHEN EXISTS (SELECT 1 FROM public.trainers t WHERE t.id::text = q.person_uuid) THEN 'trainer'
  WHEN EXISTS (SELECT 1 FROM public.members m WHERE m.id::text = q.person_uuid) THEN 'member'
  WHEN EXISTS (SELECT 1 FROM public.employees e WHERE e.id::text = q.person_uuid) THEN 'employee'
  ELSE q.person_type
END
WHERE q.person_type IS NULL;

ALTER TABLE public.biometric_sync_queue
  DROP CONSTRAINT IF EXISTS biometric_sync_queue_person_type_chk;
ALTER TABLE public.biometric_sync_queue
  ADD CONSTRAINT biometric_sync_queue_person_type_chk
  CHECK (person_type IS NULL OR person_type IN ('member','employee','trainer'));
CREATE INDEX IF NOT EXISTS idx_biometric_sync_queue_person
  ON public.biometric_sync_queue(person_type, person_uuid, status, queued_at);

ALTER TABLE public.mips_sync_attempts
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS mips_person_id bigint,
  ADD COLUMN IF NOT EXISTS operation text NOT NULL DEFAULT 'device_dispatch',
  ADD COLUMN IF NOT EXISTS response_code integer,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS response_payload jsonb,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE public.mips_sync_attempts
SET entity_type = CASE WHEN member_id IS NOT NULL THEN 'member' WHEN staff_id IS NOT NULL THEN 'employee' END,
    entity_id = COALESCE(member_id, staff_id)
WHERE entity_type IS NULL OR entity_id IS NULL;

ALTER TABLE public.mips_sync_attempts
  DROP CONSTRAINT IF EXISTS mips_sync_attempts_subject_chk;
ALTER TABLE public.mips_sync_attempts
  ADD CONSTRAINT mips_sync_attempts_subject_chk
  CHECK (entity_id IS NOT NULL OR member_id IS NOT NULL OR staff_id IS NOT NULL);
ALTER TABLE public.mips_sync_attempts
  DROP CONSTRAINT IF EXISTS mips_sync_attempts_entity_type_chk;
ALTER TABLE public.mips_sync_attempts
  ADD CONSTRAINT mips_sync_attempts_entity_type_chk
  CHECK (entity_type IS NULL OR entity_type IN ('member','employee','trainer'));
ALTER TABLE public.mips_sync_attempts
  DROP CONSTRAINT IF EXISTS mips_sync_attempts_status_chk;
ALTER TABLE public.mips_sync_attempts
  ADD CONSTRAINT mips_sync_attempts_status_chk
  CHECK (status IN ('pending','processing','success','failed','abandoned'));

CREATE INDEX IF NOT EXISTS idx_mips_sync_attempts_entity_device
  ON public.mips_sync_attempts(entity_type, entity_id, device_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mips_sync_attempts_open_delivery
  ON public.mips_sync_attempts(entity_type, entity_id, device_id, operation)
  WHERE status IN ('pending','processing');

GRANT SELECT ON public.mips_sync_attempts TO authenticated;
GRANT ALL ON public.mips_sync_attempts TO service_role;
GRANT SELECT ON public.mips_sync_failures TO authenticated;
GRANT ALL ON public.mips_sync_failures TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.biometric_sync_queue TO authenticated;
GRANT ALL ON public.biometric_sync_queue TO service_role;

CREATE OR REPLACE FUNCTION public.tg_push_photo_to_mips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_person_type text;
  v_hw_enabled boolean;
  v_new_path text;
  v_old_path text;
  v_new_url text;
  v_old_url text;
  v_photo_ref text;
  v_person_name text;
BEGIN
  v_person_type := CASE TG_TABLE_NAME
    WHEN 'members' THEN 'member'
    WHEN 'employees' THEN 'employee'
    WHEN 'trainers' THEN 'trainer'
    ELSE NULL
  END;
  IF v_person_type IS NULL THEN RETURN NEW; END IF;

  v_new_path := row_to_json(NEW)->>'biometric_photo_path';
  v_old_path := row_to_json(OLD)->>'biometric_photo_path';
  v_new_url := row_to_json(NEW)->>'biometric_photo_url';
  v_old_url := row_to_json(OLD)->>'biometric_photo_url';
  v_photo_ref := COALESCE(NULLIF(btrim(v_new_path), ''), NULLIF(btrim(v_new_url), ''));
  v_hw_enabled := COALESCE((row_to_json(NEW)->>'hardware_access_enabled')::boolean, true);

  IF v_photo_ref IS NULL OR NOT v_hw_enabled THEN RETURN NEW; END IF;
  IF v_new_path IS NOT DISTINCT FROM v_old_path AND v_new_url IS NOT DISTINCT FROM v_old_url THEN RETURN NEW; END IF;

  SELECT COALESCE(p.full_name, row_to_json(NEW)->>'full_name', row_to_json(NEW)->>'name', '')
    INTO v_person_name
  FROM (SELECT 1) seed
  LEFT JOIN public.profiles p ON p.id = NULLIF(row_to_json(NEW)->>'user_id','')::uuid;

  INSERT INTO public.biometric_sync_queue (
    member_id, staff_id, sync_type, photo_url, person_uuid, person_type,
    person_name, status, retry_count, queued_at, processed_at, error_message
  ) VALUES (
    CASE WHEN v_person_type='member' THEN NEW.id ELSE NULL END,
    CASE WHEN v_person_type='employee' THEN NEW.id ELSE NULL END,
    'photo_upload', v_photo_ref, NEW.id::text, v_person_type,
    COALESCE(NULLIF(v_person_name,''), initcap(v_person_type)),
    'pending', 0, now(), NULL, NULL
  )
  ON CONFLICT (person_uuid, device_id) DO UPDATE SET
    person_type = EXCLUDED.person_type,
    photo_url = EXCLUDED.photo_url,
    person_name = EXCLUDED.person_name,
    status = 'pending',
    retry_count = 0,
    queued_at = now(),
    processed_at = NULL,
    error_message = NULL;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_error_event(
    'warning','database',SQLERRM,'tg_push_photo_to_mips',NULL,TG_TABLE_NAME,
    NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('person_type',v_person_type,'person_id',NEW.id)
  );
  RETURN NEW;
END;
$func$;

UPDATE public.biometric_sync_queue q
SET person_type = CASE
      WHEN EXISTS (SELECT 1 FROM public.trainers t WHERE t.id::text=q.person_uuid) THEN 'trainer'
      WHEN EXISTS (SELECT 1 FROM public.members m WHERE m.id::text=q.person_uuid) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM public.employees e WHERE e.id::text=q.person_uuid) THEN 'employee'
      ELSE q.person_type
    END,
    member_id = CASE WHEN EXISTS (SELECT 1 FROM public.members m WHERE m.id::text=q.person_uuid) THEN q.person_uuid::uuid ELSE q.member_id END,
    staff_id = CASE WHEN EXISTS (SELECT 1 FROM public.employees e WHERE e.id::text=q.person_uuid) THEN q.person_uuid::uuid ELSE q.staff_id END,
    status = 'pending', retry_count = 0, processed_at = NULL, error_message = NULL
WHERE q.status='failed'
  AND q.error_message ILIKE 'no member_id/staff_id%'
  AND (
    EXISTS (SELECT 1 FROM public.trainers t WHERE t.id::text=q.person_uuid)
    OR EXISTS (SELECT 1 FROM public.members m WHERE m.id::text=q.person_uuid)
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id::text=q.person_uuid)
  );