-- Sarvam Voice AI integration: provider config, server-only secret, call attempt ledger

CREATE TABLE public.voice_provider_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'sarvam',
  is_active boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  retention_automation jsonb NOT NULL DEFAULT jsonb_build_object(
    'enabled', false,
    'min_absent_days', 7,
    'timezone', 'Asia/Kolkata',
    'window_start', '10:00',
    'window_end', '19:00',
    'max_calls_per_day', 25,
    'cooldown_days', 7,
    'require_active_membership', true,
    'require_no_dnc', true,
    'exclude_recent_human_contact_days', 3,
    'branch_ids', '[]'::jsonb
  ),
  api_key_last4 text,
  api_key_set_at timestamptz,
  last_check_at timestamptz,
  last_check_status text,
  last_check_error text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX voice_provider_integrations_scope_uniq
  ON public.voice_provider_integrations (provider, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

GRANT SELECT ON public.voice_provider_integrations TO authenticated;
GRANT ALL ON public.voice_provider_integrations TO service_role;
ALTER TABLE public.voice_provider_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read voice provider integrations"
  ON public.voice_provider_integrations FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role]));

CREATE TRIGGER update_voice_provider_integrations_updated_at
  BEFORE UPDATE ON public.voice_provider_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Server-only secret store. No policies + no grants = unreachable from any client role.
CREATE TABLE public.voice_provider_secrets (
  integration_id uuid PRIMARY KEY REFERENCES public.voice_provider_integrations(id) ON DELETE CASCADE,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.voice_provider_secrets TO service_role;
ALTER TABLE public.voice_provider_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_provider_secrets FROM anon, authenticated;

CREATE TABLE public.voice_call_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'sarvam',
  source text NOT NULL,
  member_id uuid,
  lead_id uuid,
  phone text NOT NULL,
  agent_id text,
  agent_version integer,
  campaign_ref text,
  provider_call_id text,
  provider_interaction_id text,
  status text NOT NULL DEFAULT 'queued',
  disposition text,
  duration_seconds numeric,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  error_code text,
  error_message text,
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_call_attempts_status_chk CHECK (status IN ('queued','ringing','connected','no_answer','busy','failed','completed','cancelled')),
  CONSTRAINT voice_call_attempts_source_chk CHECK (source IN ('manual_test','member_retention','lead_followup','campaign','inbound'))
);
CREATE INDEX voice_call_attempts_branch_started_idx ON public.voice_call_attempts (branch_id, started_at DESC);
CREATE INDEX voice_call_attempts_phone_idx ON public.voice_call_attempts (phone, started_at DESC);
CREATE UNIQUE INDEX voice_call_attempts_provider_call_id_uniq
  ON public.voice_call_attempts (provider_call_id) WHERE provider_call_id IS NOT NULL;
CREATE UNIQUE INDEX voice_call_attempts_active_phone_uniq
  ON public.voice_call_attempts (phone) WHERE status IN ('queued','ringing');

GRANT SELECT ON public.voice_call_attempts TO authenticated;
GRANT ALL ON public.voice_call_attempts TO service_role;
ALTER TABLE public.voice_call_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read voice call attempts in their branches"
  ON public.voice_call_attempts FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role, 'admin'::app_role])
    OR (branch_id IS NOT NULL AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  );

CREATE TRIGGER update_voice_call_attempts_updated_at
  BEFORE UPDATE ON public.voice_call_attempts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();