
ALTER TABLE public.rcs_templates
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'telinfy',
  ADD COLUMN IF NOT EXISTS external_template_id text;

ALTER TABLE public.rcs_templates
  DROP CONSTRAINT IF EXISTS rcs_templates_branch_id_template_name_key;

ALTER TABLE public.rcs_templates
  ADD CONSTRAINT rcs_templates_branch_provider_name_key
  UNIQUE (branch_id, provider, template_name);

CREATE INDEX IF NOT EXISTS rcs_templates_provider_idx
  ON public.rcs_templates (provider);
