ALTER TABLE public.contracts ALTER COLUMN employee_id DROP NOT NULL;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_party_present_chk
  CHECK (employee_id IS NOT NULL OR trainer_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_contracts_trainer_id ON public.contracts(trainer_id);