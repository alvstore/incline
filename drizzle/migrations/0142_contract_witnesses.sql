CREATE TABLE public.contract_witnesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES public.branches(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  phone text,
  designation text,
  signature_path text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contract_witnesses_branch_idx ON public.contract_witnesses (branch_id, is_active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_witnesses TO authenticated;
GRANT ALL ON public.contract_witnesses TO service_role;
ALTER TABLE public.contract_witnesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY contract_witnesses_manage ON public.contract_witnesses
FOR ALL TO authenticated
USING (
  (SELECT has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
  OR ((SELECT has_role(auth.uid(), 'manager'::app_role))
      AND branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
)
WITH CHECK (
  (SELECT has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
  OR ((SELECT has_role(auth.uid(), 'manager'::app_role))
      AND branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
);

CREATE TRIGGER contract_witnesses_set_updated_at
  BEFORE UPDATE ON public.contract_witnesses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER contract_witnesses_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.contract_witnesses
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger_function();

CREATE POLICY witness_signatures_manage ON storage.objects
FOR ALL TO authenticated
USING (
  bucket_id = 'witness-signatures' AND (
    (SELECT has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
    OR ((SELECT has_role(auth.uid(), 'manager'::app_role))
        AND (storage.foldername(name))[1] IN (SELECT b::text FROM user_visible_branch_ids(auth.uid()) b))
  )
)
WITH CHECK (
  bucket_id = 'witness-signatures' AND (
    (SELECT has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
    OR ((SELECT has_role(auth.uid(), 'manager'::app_role))
        AND (storage.foldername(name))[1] IN (SELECT b::text FROM user_visible_branch_ids(auth.uid()) b))
  )
);