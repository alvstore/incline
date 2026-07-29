
-- ============================================================
-- 1. Enforce mandatory 5% GST on PT purchases + invoice items
-- ============================================================

-- Guard clause inside purchase_pt_package
CREATE OR REPLACE FUNCTION public.purchase_pt_package(
  _member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid,
  _price_paid numeric, _gst_rate numeric DEFAULT 5,
  _payment_method text DEFAULT 'cash', _payment_source text DEFAULT 'in_person',
  _idempotency_key text DEFAULT NULL, _received_by uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _result jsonb;
BEGIN
  IF _gst_rate IS NULL OR _gst_rate <> 5 THEN
    RAISE EXCEPTION 'pt_gst_must_be_5'
      USING HINT = 'Personal training GST is fixed at 5% (inclusive).';
  END IF;
  -- Delegate to the internal implementation (unchanged logic)
  SELECT public._purchase_pt_package_impl(
    _member_id, _package_id, _trainer_id, _branch_id, _price_paid,
    _gst_rate, _payment_method, _payment_source, _idempotency_key, _received_by
  ) INTO _result;
  RETURN _result;
END;
$$;

-- If the internal impl doesn't exist yet, alias the existing body. We
-- rename the old function so the wrapper above forwards to it.
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = '_purchase_pt_package_impl'
  ) THEN
    -- Copy the pre-existing implementation body into the impl function.
    -- Fetch and re-CREATE via dynamic SQL preserving the exact body.
    EXECUTE (
      SELECT replace(
        pg_get_functiondef(oid),
        'FUNCTION public.purchase_pt_package(',
        'FUNCTION public._purchase_pt_package_impl('
      )
      FROM pg_proc
      WHERE proname = 'purchase_pt_package'
        AND pg_get_function_identity_arguments(oid)
            LIKE '_member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid, _price_paid numeric%'
      LIMIT 1
    );
  END IF;
END
$mig$;

-- Now recreate the public wrapper (previous CREATE OR REPLACE already
-- overwrote the old body — but we need to ensure the impl exists first,
-- then re-declare the wrapper cleanly).
CREATE OR REPLACE FUNCTION public.purchase_pt_package(
  _member_id uuid, _package_id uuid, _trainer_id uuid, _branch_id uuid,
  _price_paid numeric, _gst_rate numeric DEFAULT 5,
  _payment_method text DEFAULT 'cash', _payment_source text DEFAULT 'in_person',
  _idempotency_key text DEFAULT NULL, _received_by uuid DEFAULT auth.uid()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF _gst_rate IS NULL OR _gst_rate <> 5 THEN
    RAISE EXCEPTION 'pt_gst_must_be_5'
      USING HINT = 'Personal training GST is fixed at 5% (inclusive).';
  END IF;
  RETURN public._purchase_pt_package_impl(
    _member_id, _package_id, _trainer_id, _branch_id, _price_paid,
    _gst_rate, _payment_method, _payment_source, _idempotency_key, _received_by
  );
END;
$$;

-- Trigger: any invoice line with reference_type='pt_package' must be at 5% GST
CREATE OR REPLACE FUNCTION public.enforce_pt_invoice_gst()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF NEW.reference_type = 'pt_package'
     AND COALESCE(NEW.tax_rate, 0) <> 5 THEN
    RAISE EXCEPTION 'pt_invoice_gst_must_be_5'
      USING HINT = 'Personal training invoice lines must use 5% GST.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_pt_invoice_gst ON public.invoice_items;
CREATE TRIGGER trg_enforce_pt_invoice_gst
  BEFORE INSERT OR UPDATE OF tax_rate, reference_type ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pt_invoice_gst();

-- ============================================================
-- 2. Security finding: hr_settings — scope managers to their branches
-- ============================================================

DROP POLICY IF EXISTS "hr_settings_staff_read" ON public.hr_settings;
CREATE POLICY "hr_settings_staff_read" ON public.hr_settings
  FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (
      has_any_role(auth.uid(), ARRAY['manager'::app_role])
      AND (
        branch_id IS NULL  -- global config visible to managers
        OR branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
    )
  );

-- ============================================================
-- 3. Security finding: member_onboarding_signatures — branch scope
-- ============================================================

DROP POLICY IF EXISTS "Staff+ reads branch onboarding signatures"
  ON public.member_onboarding_signatures;
CREATE POLICY "Staff+ reads branch onboarding signatures"
  ON public.member_onboarding_signatures
  FOR SELECT TO authenticated
  USING (
    has_capability(auth.uid(), 'view_member_documents')
    AND (
      has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
      OR EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id = member_onboarding_signatures.member_id
          AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
    )
  );

-- Storage bucket policy: mirror the same branch scoping
-- (files live under `<member_id>/...`)
DROP POLICY IF EXISTS "Staff+ reads branch onboarding files" ON storage.objects;
CREATE POLICY "Staff+ reads branch onboarding files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'member-onboarding'
    AND has_capability(auth.uid(), 'view_member_documents')
    AND (
      has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
      OR EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.id::text = (storage.foldername(objects.name))[1]
          AND m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
      )
    )
  );
