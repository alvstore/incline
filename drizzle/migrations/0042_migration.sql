CREATE TABLE IF NOT EXISTS public.zoho_direct_credentials (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  client_id text, client_secret text, refresh_token text,
  dc text NOT NULL DEFAULT 'in' CHECK (dc IN ('in','com','eu')),
  organization_id text, org_name text,
  connected_by uuid, connected_at timestamptz,
  last_test_ok_at timestamptz, last_refresh_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zoho_direct_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zoho_direct_credentials FROM anon, authenticated;
GRANT ALL ON public.zoho_direct_credentials TO service_role;

CREATE TABLE IF NOT EXISTS public.zoho_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.zoho_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.zoho_oauth_states FROM anon, authenticated;
GRANT ALL ON public.zoho_oauth_states TO service_role;