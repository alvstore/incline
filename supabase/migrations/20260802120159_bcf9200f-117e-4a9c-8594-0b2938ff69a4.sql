CREATE TABLE public.ai_plan_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  requested_by UUID,
  type TEXT NOT NULL CHECK (type IN ('workout','diet')),
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error','cancelled')),
  stage TEXT,
  result JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_plan_jobs_requested_by ON public.ai_plan_jobs (requested_by, created_at DESC);
CREATE INDEX idx_ai_plan_jobs_status ON public.ai_plan_jobs (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.ai_plan_jobs TO authenticated;
GRANT ALL ON public.ai_plan_jobs TO service_role;

ALTER TABLE public.ai_plan_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_plan_jobs_own_rw" ON public.ai_plan_jobs
  FOR ALL TO authenticated
  USING (requested_by = auth.uid())
  WITH CHECK (requested_by = auth.uid());

CREATE POLICY "ai_plan_jobs_staff_read" ON public.ai_plan_jobs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR (
      public.has_role(auth.uid(), 'manager')
      AND branch_id IN (SELECT public.user_visible_branch_ids(auth.uid()))
    )
  );

CREATE TRIGGER update_ai_plan_jobs_updated_at
  BEFORE UPDATE ON public.ai_plan_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_plan_jobs;