
CREATE TABLE IF NOT EXISTS public.rcs_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  body_preview text,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'approved',
  raw jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, template_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rcs_templates TO authenticated;
GRANT ALL ON public.rcs_templates TO service_role;
ALTER TABLE public.rcs_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcs_templates_read_staff" ON public.rcs_templates FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role));
CREATE POLICY "rcs_templates_write_admin" ON public.rcs_templates FOR ALL TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.rcs_wallet_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  balance numeric(14,2),
  currency text DEFAULT 'INR',
  raw jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rcs_wallet_snapshots TO authenticated;
GRANT ALL ON public.rcs_wallet_snapshots TO service_role;
ALTER TABLE public.rcs_wallet_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcs_wallet_read_admin" ON public.rcs_wallet_snapshots FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS idx_rcs_wallet_fetched ON public.rcs_wallet_snapshots(branch_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS public.rcs_inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('user_action','user_message')),
  sender_phone text NOT NULL,
  record_id text,
  message_id text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rcs_inbound_events TO authenticated;
GRANT ALL ON public.rcs_inbound_events TO service_role;
ALTER TABLE public.rcs_inbound_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rcs_inbound_read_staff" ON public.rcs_inbound_events FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'staff'::app_role));
CREATE INDEX IF NOT EXISTS idx_rcs_inbound_phone ON public.rcs_inbound_events(sender_phone, received_at DESC);

ALTER TABLE public.communication_logs ADD COLUMN IF NOT EXISTS provider_record_id text;
CREATE INDEX IF NOT EXISTS idx_comm_logs_provider_record_id
  ON public.communication_logs(provider_record_id) WHERE provider_record_id IS NOT NULL;

DROP POLICY IF EXISTS "auth write suggestions" ON public.ai_dynamic_memory_suggestions;
DROP POLICY IF EXISTS "auth update suggestions" ON public.ai_dynamic_memory_suggestions;
DROP POLICY IF EXISTS "auth delete suggestions" ON public.ai_dynamic_memory_suggestions;
DROP POLICY IF EXISTS "auth read suggestions" ON public.ai_dynamic_memory_suggestions;

CREATE POLICY "suggestions_read_staff" ON public.ai_dynamic_memory_suggestions FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));
CREATE POLICY "suggestions_insert_staff" ON public.ai_dynamic_memory_suggestions FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));
CREATE POLICY "suggestions_update_admin" ON public.ai_dynamic_memory_suggestions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "suggestions_delete_admin" ON public.ai_dynamic_memory_suggestions FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'owner'::app_role) OR has_role(auth.uid(),'admin'::app_role));
