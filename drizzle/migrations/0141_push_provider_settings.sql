CREATE TABLE public.push_provider_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  project_id text,
  client_email text,
  enabled boolean NOT NULL DEFAULT false,
  last_test_ok boolean,
  last_test_at timestamptz,
  last_test_error text,
  key_uploaded_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.push_provider_settings TO authenticated;
GRANT ALL ON public.push_provider_settings TO service_role;
ALTER TABLE public.push_provider_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_admin_read_push_settings" ON public.push_provider_settings
  FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[])));

-- Private key: service role only, no client policies.
CREATE TABLE public.push_provider_secrets (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  private_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.push_provider_secrets FROM anon, authenticated;
GRANT ALL ON public.push_provider_secrets TO service_role;
ALTER TABLE public.push_provider_secrets ENABLE ROW LEVEL SECURITY;