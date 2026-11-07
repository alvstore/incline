ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS policy_snapshot jsonb;
COMMENT ON COLUMN public.contracts.policy_snapshot IS 'Policy Library versions attached as Annexure B; frozen once signed.';

CREATE OR REPLACE FUNCTION public.build_contract_policy_snapshot(_role text, _branch uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'policy_id', p.id, 'code', p.code, 'title', p.title, 'version', p.version,
    'effective_from', p.effective_from, 'body_markdown', p.body_markdown,
    'body_hash', encode(extensions.digest(p.body_markdown, 'sha256'), 'hex')
  ) ORDER BY p.title), '[]'::jsonb)
  FROM (
    SELECT DISTINCT ON (code) * FROM public.policies
    WHERE is_active AND (branch_id IS NULL OR branch_id = _branch)
      AND (NULLIF(_role,'') IS NULL OR _role = ANY(applicable_roles))
    ORDER BY code, (branch_id IS NOT NULL) DESC, version DESC
  ) p;
$$;
REVOKE EXECUTE ON FUNCTION public.build_contract_policy_snapshot(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_contract_policy_snapshot(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_contract_policy_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text;
BEGIN
  IF NEW.signature_status = 'signed' OR NEW.signed_at IS NOT NULL THEN
    IF TG_OP = 'UPDATE' THEN NEW.policy_snapshot := OLD.policy_snapshot; END IF;
    RETURN NEW;
  END IF;
  _role := COALESCE(NULLIF(NEW.contract_variables->>'agreement_role',''),
                    NULLIF(NEW.terms->'compliance_meta'->>'agreement_role',''));
  NEW.policy_snapshot := public.build_contract_policy_snapshot(_role, NEW.branch_id);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_contract_policy_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_contract_policy_snapshot ON public.contracts;
CREATE TRIGGER trg_contract_policy_snapshot BEFORE INSERT OR UPDATE ON public.contracts
FOR EACH ROW EXECUTE FUNCTION public.tg_contract_policy_snapshot();

UPDATE public.contracts SET policy_snapshot = public.build_contract_policy_snapshot(
  COALESCE(NULLIF(contract_variables->>'agreement_role',''), NULLIF(terms->'compliance_meta'->>'agreement_role','')), branch_id)
WHERE signature_status IS DISTINCT FROM 'signed' AND signed_at IS NULL;