
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS exit_date date,
  ADD COLUMN IF NOT EXISTS exit_type text,
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exit_notes text,
  ADD COLUMN IF NOT EXISTS exited_by uuid;

ALTER TABLE public.trainers
  ADD COLUMN IF NOT EXISTS exit_date date,
  ADD COLUMN IF NOT EXISTS exit_type text,
  ADD COLUMN IF NOT EXISTS exit_reason text,
  ADD COLUMN IF NOT EXISTS exit_notes text,
  ADD COLUMN IF NOT EXISTS exited_by uuid;

CREATE INDEX IF NOT EXISTS idx_employees_branch_active_exit
  ON public.employees(branch_id, is_active, exit_date);
CREATE INDEX IF NOT EXISTS idx_trainers_branch_active_exit
  ON public.trainers(branch_id, is_active, exit_date);
