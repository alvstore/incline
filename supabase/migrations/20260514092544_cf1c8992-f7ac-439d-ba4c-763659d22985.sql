
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS plan_interest text;

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  lead_capture_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_questions text[] NOT NULL DEFAULT '{}'::text[],
  consecutive_tool_errors integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_state_phone
  ON public.whatsapp_conversation_state (phone_number);

ALTER TABLE public.whatsapp_conversation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view conversation state"
ON public.whatsapp_conversation_state
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'manager'::app_role)
  OR public.has_role(auth.uid(), 'staff'::app_role)
);

CREATE TABLE IF NOT EXISTS public.automation_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NULL REFERENCES public.branches(id) ON DELETE SET NULL,
  conversation_key text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_diag_conv
  ON public.automation_diagnostics (conversation_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_diag_kind
  ON public.automation_diagnostics (kind, created_at DESC);

ALTER TABLE public.automation_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view automation diagnostics"
ON public.automation_diagnostics
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'manager'::app_role)
);
