
-- =====================================================================
-- HRM v2 — 2026 India Compliance Foundation
-- =====================================================================

-- 1) EMPLOYEES — add statutory + identity columns (all nullable, backfilled later)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS father_or_spouse_name text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS blood_group text,
  ADD COLUMN IF NOT EXISTS marital_status text,
  ADD COLUMN IF NOT EXISTS nationality text DEFAULT 'Indian',
  ADD COLUMN IF NOT EXISTS pan_number text,
  ADD COLUMN IF NOT EXISTS aadhaar_last4 text,
  ADD COLUMN IF NOT EXISTS aadhaar_hash text,
  ADD COLUMN IF NOT EXISTS uan_number text,
  ADD COLUMN IF NOT EXISTS esic_ip_number text,
  ADD COLUMN IF NOT EXISTS current_address jsonb,
  ADD COLUMN IF NOT EXISTS permanent_address jsonb,
  ADD COLUMN IF NOT EXISTS emergency_contact jsonb,
  ADD COLUMN IF NOT EXISTS nominee jsonb,
  ADD COLUMN IF NOT EXISTS bank_ifsc text,
  ADD COLUMN IF NOT EXISTS pf_opt_in boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS medical_fitness_declared_at timestamptz,
  ADD COLUMN IF NOT EXISTS certifications jsonb;

COMMENT ON COLUMN public.employees.aadhaar_last4 IS 'Only last 4 digits of Aadhaar are stored. Full Aadhaar never persisted.';
COMMENT ON COLUMN public.employees.aadhaar_hash IS 'SHA-256 hash of the full Aadhaar for de-dup; original is discarded.';

-- 2) CONTRACTS — tamper evidence + stamped artifact + witness blocks
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS terms_version int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS terms_hash text,
  ADD COLUMN IF NOT EXISTS stamped_pdf_path text,
  ADD COLUMN IF NOT EXISTS signed_pdf_hash text,
  ADD COLUMN IF NOT EXISTS witness_1 jsonb,
  ADD COLUMN IF NOT EXISTS witness_2 jsonb,
  ADD COLUMN IF NOT EXISTS governing_jurisdiction text DEFAULT 'Udaipur, Rajasthan',
  ADD COLUMN IF NOT EXISTS arbitration_seat text DEFAULT 'Udaipur',
  ADD COLUMN IF NOT EXISTS notice_period_days int DEFAULT 30;

-- 3) CONTRACT_SIGNATURES — richer evidence
ALTER TABLE public.contract_signatures
  ADD COLUMN IF NOT EXISTS signature_image_path text,
  ADD COLUMN IF NOT EXISTS selfie_path text,
  ADD COLUMN IF NOT EXISTS geolocation jsonb,
  ADD COLUMN IF NOT EXISTS otp_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS otp_channel text,
  ADD COLUMN IF NOT EXISTS terms_hash_at_sign text;

-- 4) POLICIES — versioned company policy library
CREATE TABLE IF NOT EXISTS public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  title text NOT NULL,
  version int NOT NULL DEFAULT 1,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  applicable_roles text[] NOT NULL DEFAULT ARRAY['owner','admin','manager','staff','trainer']::text[],
  body_markdown text NOT NULL,
  pdf_path text,
  is_active boolean NOT NULL DEFAULT true,
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_policies_code_active ON public.policies(code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_policies_branch ON public.policies(branch_id);

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "policies_admin_manage"
  ON public.policies
  FOR ALL
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "policies_staff_read_active"
  ON public.policies
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role, 'trainer'::app_role])
  );

CREATE TRIGGER trg_policies_updated_at
  BEFORE UPDATE ON public.policies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- 5) POLICY_ACKNOWLEDGEMENTS — per-user, per-version signatures
CREATE TABLE IF NOT EXISTS public.policy_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  policy_code text NOT NULL,
  policy_version int NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  trainer_id uuid REFERENCES public.trainers(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  signed_name text NOT NULL,
  signature_image_path text,
  body_hash text NOT NULL,
  ip_address text,
  user_agent text,
  geolocation jsonb,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, policy_version, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pack_user ON public.policy_acknowledgements(user_id);
CREATE INDEX IF NOT EXISTS idx_pack_policy ON public.policy_acknowledgements(policy_id);
CREATE INDEX IF NOT EXISTS idx_pack_branch ON public.policy_acknowledgements(branch_id);

ALTER TABLE public.policy_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pack_user_insert_own"
  ON public.policy_acknowledgements
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "pack_user_select_own"
  ON public.policy_acknowledgements
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role])
  );

CREATE POLICY "pack_admin_manage"
  ON public.policy_acknowledgements
  FOR ALL
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

-- 6) HR_SETTINGS — single-row config per branch (or NULL = global default)
CREATE TABLE IF NOT EXISTS public.hr_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid UNIQUE REFERENCES public.branches(id) ON DELETE CASCADE,
  employer_legal_name text NOT NULL DEFAULT 'Incline (Proprietorship Firm)',
  employer_registered_address text,
  employer_gstin text,
  employer_pan text,
  employer_firm_registration_no text,
  employer_proprietor_name text DEFAULT 'Yogita Lekhari',
  logo_storage_path text,
  posh_ic jsonb,  -- {presiding_officer, members[], external_member, grievance_email}
  lawyer_reviewed_by text,
  lawyer_reviewed_at date,
  notice_period_staff_days int NOT NULL DEFAULT 30,
  notice_period_trainer_days int NOT NULL DEFAULT 60,
  notice_period_manager_days int NOT NULL DEFAULT 90,
  arbitration_seat text NOT NULL DEFAULT 'Udaipur',
  governing_jurisdiction text NOT NULL DEFAULT 'Udaipur, Rajasthan',
  weekly_hour_cap int NOT NULL DEFAULT 48,
  daily_hour_cap int NOT NULL DEFAULT 9,
  ot_multiplier numeric(3,1) NOT NULL DEFAULT 2.0,
  pt_commission_clawback_on_refund boolean NOT NULL DEFAULT true,
  basic_pct_of_ctc numeric(4,1) NOT NULL DEFAULT 50.0,  -- Code on Wages 2019
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_settings_global ON public.hr_settings ((branch_id IS NULL)) WHERE branch_id IS NULL;

ALTER TABLE public.hr_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_settings_admin_manage"
  ON public.hr_settings
  FOR ALL
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE POLICY "hr_settings_staff_read"
  ON public.hr_settings
  FOR SELECT
  TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role, 'staff'::app_role, 'trainer'::app_role]));

CREATE TRIGGER trg_hr_settings_updated_at
  BEFORE UPDATE ON public.hr_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Seed the global default row
INSERT INTO public.hr_settings (branch_id, employer_registered_address)
VALUES (NULL, 'Sector 14, Udaipur, Rajasthan, India')
ON CONFLICT DO NOTHING;

-- 7) STORAGE BUCKETS (all private)
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('contract-pdfs', 'contract-pdfs', false),
  ('signature-assets', 'signature-assets', false),
  ('policy-pdfs', 'policy-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: only owner/admin/manager can manage; signed-URL access for everyone else
CREATE POLICY "contract_pdfs_admin_all"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'contract-pdfs'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role])
  )
  WITH CHECK (
    bucket_id = 'contract-pdfs'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role])
  );

CREATE POLICY "signature_assets_admin_all"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'signature-assets'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role])
  )
  WITH CHECK (
    bucket_id = 'signature-assets'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role, 'manager'::app_role])
  );

CREATE POLICY "policy_pdfs_admin_write"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'policy-pdfs'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  )
  WITH CHECK (
    bucket_id = 'policy-pdfs'
    AND has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
  );

CREATE POLICY "policy_pdfs_authed_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'policy-pdfs');
