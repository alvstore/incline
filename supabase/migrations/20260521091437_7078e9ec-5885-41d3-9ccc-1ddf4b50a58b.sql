-- Drop the contract-specific OTP table (replaced by shared otp_verifications).
DROP TABLE IF EXISTS public.contract_sign_otps CASCADE;

-- Extend the existing shared OTP table to support multiple flows.
ALTER TABLE public.otp_verifications
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS context_id uuid;

CREATE INDEX IF NOT EXISTS idx_otp_verif_purpose_context
  ON public.otp_verifications (purpose, context_id, created_at DESC);