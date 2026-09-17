CREATE TABLE public.agent_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  published_graph jsonb,
  published_at timestamptz,
  published_by uuid,
  version int NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_flows_branch_key_uidx
  ON public.agent_flows (COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

CREATE TABLE public.agent_flow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id uuid NOT NULL REFERENCES public.agent_flows(id) ON DELETE CASCADE,
  version int NOT NULL,
  graph jsonb NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_flow_versions_flow_idx ON public.agent_flow_versions (flow_id, version DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_flows TO authenticated;
GRANT ALL ON public.agent_flows TO service_role;
GRANT SELECT, INSERT ON public.agent_flow_versions TO authenticated;
GRANT ALL ON public.agent_flow_versions TO service_role;

ALTER TABLE public.agent_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_flow_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read agent flows"
ON public.agent_flows FOR SELECT TO authenticated
USING (
  branch_id IS NULL
  OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
);

CREATE POLICY "Managers can write agent flows"
ON public.agent_flows FOR ALL TO authenticated
USING (
  (has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
   OR (has_role(auth.uid(), 'manager'::app_role)
       AND branch_id IS NOT NULL
       AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
)
WITH CHECK (
  (has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
   OR (has_role(auth.uid(), 'manager'::app_role)
       AND branch_id IS NOT NULL
       AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
);

CREATE POLICY "Staff can read agent flow versions"
ON public.agent_flow_versions FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.agent_flows f
    WHERE f.id = agent_flow_versions.flow_id
      AND (f.branch_id IS NULL OR f.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  )
);

CREATE POLICY "Managers can add agent flow versions"
ON public.agent_flow_versions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.agent_flows f
    WHERE f.id = agent_flow_versions.flow_id
      AND (has_role(auth.uid(), 'owner'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
           OR (has_role(auth.uid(), 'manager'::app_role)
               AND f.branch_id IS NOT NULL
               AND f.branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))))
  )
);

CREATE TRIGGER agent_flows_set_updated_at
BEFORE UPDATE ON public.agent_flows
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();