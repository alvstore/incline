ALTER TABLE public.rcs_templates
  ADD COLUMN IF NOT EXISTS kind TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT;
COMMENT ON COLUMN public.rcs_templates.kind IS 'Telinfy bucket: rich_standard | basic_standard | rich_dynamic | basic_dynamic';