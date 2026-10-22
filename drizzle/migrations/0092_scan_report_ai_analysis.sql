CREATE TABLE public.scan_report_ai_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('body','posture')),
  member_id uuid NOT NULL,
  branch_id uuid,
  input_hash text NOT NULL,
  analysis jsonb NOT NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_id, kind)
);
CREATE INDEX scan_report_ai_analysis_member_idx ON public.scan_report_ai_analysis(member_id);
GRANT SELECT ON public.scan_report_ai_analysis TO authenticated;
GRANT ALL ON public.scan_report_ai_analysis TO service_role;
ALTER TABLE public.scan_report_ai_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scan ai analysis readable like its report"
ON public.scan_report_ai_analysis FOR SELECT TO authenticated
USING (
  (kind = 'body' AND EXISTS (SELECT 1 FROM public.howbody_body_reports r WHERE r.id = report_id))
  OR (kind = 'posture' AND EXISTS (SELECT 1 FROM public.howbody_posture_reports r WHERE r.id = report_id))
);