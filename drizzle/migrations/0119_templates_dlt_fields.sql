ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS dlt_template_id text,
  ADD COLUMN IF NOT EXISTS dlt_header text,
  ADD COLUMN IF NOT EXISTS dlt_category text;
COMMENT ON COLUMN public.templates.dlt_template_id IS 'Approved DLT (TRAI) template id for SMS; SMS without it must not be sent.';