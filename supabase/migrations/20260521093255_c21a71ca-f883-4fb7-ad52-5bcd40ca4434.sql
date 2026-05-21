ALTER TABLE public.contract_signature_requests
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'employee';

ALTER TABLE public.contract_signature_requests
  DROP CONSTRAINT IF EXISTS contract_signature_requests_role_check;
ALTER TABLE public.contract_signature_requests
  ADD CONSTRAINT contract_signature_requests_role_check
  CHECK (role IN ('employee','witness_1','witness_2','hr'));

DROP INDEX IF EXISTS contract_signature_requests_open_unique;
CREATE UNIQUE INDEX contract_signature_requests_open_unique
  ON public.contract_signature_requests (contract_id, role)
  WHERE revoked_at IS NULL AND status IN ('pending','viewed');