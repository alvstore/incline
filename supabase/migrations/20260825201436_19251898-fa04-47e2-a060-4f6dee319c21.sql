CREATE TABLE public.template_manager_state (
  job_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'paused', 'failed')),
  lease_until timestamptz,
  consecutive_429 integer NOT NULL DEFAULT 0 CHECK (consecutive_429 >= 0),
  paused_reason text,
  cursor_branch_id uuid,
  last_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.template_manager_state TO service_role;

ALTER TABLE public.template_manager_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.template_manager_state IS 'Private single-flight and circuit-breaker state for the bounded template catalog monitor.';

DROP TRIGGER IF EXISTS update_payroll_rules_updated_at ON public.payroll_rules;
DROP TABLE public.payroll_rules;