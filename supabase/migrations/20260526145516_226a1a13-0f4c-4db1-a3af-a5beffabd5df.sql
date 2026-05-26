-- 1) Drop obsolete full unique index (blocks history rows for same contract+role)
DROP INDEX IF EXISTS public.contract_signature_requests_contract_role_uidx;

-- 2) Ensure the correct partial unique index exists (only one OPEN per contract+role)
CREATE UNIQUE INDEX IF NOT EXISTS contract_signature_requests_open_unique
  ON public.contract_signature_requests (contract_id, role)
  WHERE revoked_at IS NULL AND status IN ('pending','viewed');

-- 3) Atomic helper: lock contract row, expire any open request for (contract, role),
-- insert fresh request, return id + branch_id.
CREATE OR REPLACE FUNCTION public.create_contract_signature_request(
  p_contract_id uuid,
  p_role text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_created_by uuid
)
RETURNS TABLE (request_id uuid, branch_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_id uuid;
  v_request_id uuid;
BEGIN
  IF p_role NOT IN ('employee','witness_1','witness_2','hr') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT c.branch_id
    INTO v_branch_id
  FROM public.contracts c
  WHERE c.id = p_contract_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract not found: %', p_contract_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.contract_signature_requests
     SET status = 'expired',
         revoked_at = now()
   WHERE contract_id = p_contract_id
     AND role = p_role
     AND revoked_at IS NULL
     AND status IN ('pending','viewed');

  INSERT INTO public.contract_signature_requests
    (contract_id, branch_id, token_hash, expires_at, created_by, status, role)
  VALUES
    (p_contract_id, v_branch_id, p_token_hash, p_expires_at, p_created_by, 'pending', p_role)
  RETURNING id INTO v_request_id;

  request_id := v_request_id;
  branch_id := v_branch_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.create_contract_signature_request(uuid,text,text,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_contract_signature_request(uuid,text,text,timestamptz,uuid) TO service_role;