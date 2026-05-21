-- Add contract_variables JSONB to contracts for server-side template rendering
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS contract_variables jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow per-role signature requests (employee / witness_1 / witness_2 / hr)
ALTER TABLE public.contract_signature_requests
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'employee';

-- Drop unique-per-contract constraint if it exists so multiple roles can have requests on one contract
DO $$
DECLARE c_name text;
BEGIN
  SELECT conname INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'public.contract_signature_requests'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) ILIKE '%(contract_id)%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%role%';
  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.contract_signature_requests DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

-- Ensure uniqueness on (contract_id, role) instead so each role gets at most one open request
CREATE UNIQUE INDEX IF NOT EXISTS contract_signature_requests_contract_role_uidx
  ON public.contract_signature_requests (contract_id, role);

CREATE INDEX IF NOT EXISTS idx_contract_signature_requests_role
  ON public.contract_signature_requests (role);