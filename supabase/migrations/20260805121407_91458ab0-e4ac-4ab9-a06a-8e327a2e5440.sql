CREATE TABLE IF NOT EXISTS public.short_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  target_url text NOT NULL,
  purpose text,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  clicks integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_short_links_code ON public.short_links(code);

GRANT SELECT ON public.short_links TO authenticated;
GRANT ALL ON public.short_links TO service_role;

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view short links"
ON public.short_links FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role]));

CREATE TRIGGER update_short_links_updated_at
BEFORE UPDATE ON public.short_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();