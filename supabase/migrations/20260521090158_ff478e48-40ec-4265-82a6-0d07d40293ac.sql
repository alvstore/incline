
-- 1) Drop duplicated employer columns (verified existing rows are empty)
ALTER TABLE public.hr_settings
  DROP COLUMN IF EXISTS employer_legal_name,
  DROP COLUMN IF EXISTS employer_registered_address,
  DROP COLUMN IF EXISTS employer_gstin,
  DROP COLUMN IF EXISTS logo_storage_path;

-- 2) Canonical employer profile resolver
CREATE OR REPLACE FUNCTION public.get_employer_profile(_branch_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH b AS (
    SELECT * FROM public.branches WHERE id = _branch_id
  ),
  o AS (
    SELECT * FROM public.organization_settings
    WHERE branch_id = _branch_id
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  ),
  o_global AS (
    SELECT * FROM public.organization_settings
    WHERE branch_id IS NULL
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  ),
  h AS (
    SELECT * FROM public.hr_settings WHERE branch_id = _branch_id
    UNION ALL
    SELECT * FROM public.hr_settings WHERE branch_id IS NULL
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'branch_id',                   _branch_id,
    'legal_name',                  COALESCE((SELECT name FROM b), (SELECT name FROM o_global), 'Incline'),
    'brand_name',                  COALESCE((SELECT name FROM o), (SELECT name FROM o_global), (SELECT name FROM b)),
    'address_line',                (SELECT address FROM b),
    'city',                        (SELECT city FROM b),
    'state',                       (SELECT state FROM b),
    'postal_code',                 (SELECT postal_code FROM b),
    'country',                     COALESCE((SELECT country FROM b), 'India'),
    'full_address', NULLIF(
      concat_ws(', ',
        NULLIF((SELECT address FROM b), ''),
        NULLIF((SELECT city FROM b), ''),
        NULLIF((SELECT state FROM b), ''),
        NULLIF((SELECT postal_code FROM b), ''),
        COALESCE(NULLIF((SELECT country FROM b), ''), 'India')
      ),
    ''),
    'gstin',                       (SELECT gstin FROM b),
    'phone',                       (SELECT phone FROM b),
    'email',                       (SELECT email FROM b),
    'logo_url',                    COALESCE((SELECT logo_url FROM o), (SELECT logo_url FROM o_global)),
    'pan',                         (SELECT employer_pan FROM h),
    'proprietor_name',             (SELECT employer_proprietor_name FROM h),
    'firm_registration_no',        (SELECT employer_firm_registration_no FROM h),
    'arbitration_seat',            (SELECT arbitration_seat FROM h),
    'governing_jurisdiction',      (SELECT governing_jurisdiction FROM h),
    'posh_ic',                     (SELECT posh_ic FROM h),
    'notice_period_staff_days',    (SELECT notice_period_staff_days FROM h),
    'notice_period_trainer_days',  (SELECT notice_period_trainer_days FROM h),
    'notice_period_manager_days',  (SELECT notice_period_manager_days FROM h),
    'basic_pct_of_ctc',            (SELECT basic_pct_of_ctc FROM h),
    'ot_multiplier',               (SELECT ot_multiplier FROM h),
    'daily_hour_cap',              (SELECT daily_hour_cap FROM h),
    'weekly_hour_cap',             (SELECT weekly_hour_cap FROM h)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_employer_profile(uuid) TO authenticated, anon, service_role;

-- 3) Contract sign OTPs
CREATE TABLE IF NOT EXISTS public.contract_sign_otps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES public.contract_signature_requests(id) ON DELETE CASCADE,
  contract_id   uuid NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  recipient     text NOT NULL,
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      int  NOT NULL DEFAULT 0,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_sign_otps_request ON public.contract_sign_otps(request_id, created_at DESC);

ALTER TABLE public.contract_sign_otps ENABLE ROW LEVEL SECURITY;

-- Service-role only; the edge function uses service role. No anon/authed access.
CREATE POLICY "deny all client access"
  ON public.contract_sign_otps
  FOR ALL
  USING (false)
  WITH CHECK (false);
