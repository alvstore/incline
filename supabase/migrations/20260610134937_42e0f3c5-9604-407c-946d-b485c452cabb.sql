
-- ============================================================
-- Security Hardening: PII & secret exposure (9 critical + warns)
-- Pattern: column-level REVOKE from authenticated for highly-sensitive cols,
-- and explicit deny policies where missing. Owner/admin & service_role retain
-- access via SECURITY DEFINER RPCs or service_role bypass.
-- ============================================================

-- ---------- 1) employees: revoke sensitive cols from authenticated ----------
REVOKE SELECT (pan_number, aadhaar_last4, aadhaar_hash, bank_account, bank_ifsc, bank_name, uan_number, esic_ip_number, salary, tax_id, salary_type)
  ON public.employees FROM authenticated;

-- ---------- 2) contracts: revoke financial cols ----------
REVOKE SELECT (salary, base_salary, commission_percentage, terms, contract_variables)
  ON public.contracts FROM authenticated;

-- ---------- 3) hr_settings: revoke employer secrets ----------
REVOKE SELECT (employer_pan, employer_firm_registration_no, posh_ic)
  ON public.hr_settings FROM authenticated;

-- ---------- 4) mips_connections: revoke password from authenticated ----------
REVOKE SELECT (password) ON public.mips_connections FROM authenticated;

-- ---------- 5) otp_verifications: explicit INSERT/UPDATE/DELETE deny ----------
DROP POLICY IF EXISTS "otp_no_client_insert" ON public.otp_verifications;
DROP POLICY IF EXISTS "otp_no_client_update" ON public.otp_verifications;
DROP POLICY IF EXISTS "otp_no_client_delete" ON public.otp_verifications;
CREATE POLICY "otp_no_client_insert" ON public.otp_verifications
  AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "otp_no_client_update" ON public.otp_verifications
  AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "otp_no_client_delete" ON public.otp_verifications
  AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

-- ---------- 6) payment_transactions: revoke gateway/webhook secrets ----------
REVOKE SELECT (gateway_signature, webhook_data, response_body, gateway_payment_id, gateway_order_id)
  ON public.payment_transactions FROM authenticated;

-- ---------- 7) profiles: revoke government_id_* ----------
REVOKE SELECT (government_id_number, government_id_type, government_id_verified, comm_consent_ip, comm_consent_user_agent)
  ON public.profiles FROM authenticated;

-- ---------- 8) trainers: revoke government_id_* ----------
REVOKE SELECT (government_id_number, government_id_type)
  ON public.trainers FROM authenticated;

-- ---------- 9) campaign_recipients: revoke phone/email/full_name ----------
REVOKE SELECT (phone, email, full_name)
  ON public.campaign_recipients FROM authenticated;

-- ---------- 10) leads: revoke consent IP/UA ----------
REVOKE SELECT (comm_consent_ip, comm_consent_user_agent)
  ON public.leads FROM authenticated;

-- ---------- 11) contacts: add role check on staff select policy ----------
DROP POLICY IF EXISTS contacts_select_staff ON public.contacts;
CREATE POLICY contacts_select_staff ON public.contacts
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff']::app_role[])
    AND (branch_id IS NULL OR branch_id IN (SELECT public.user_visible_branch_ids(auth.uid())))
  );

-- ============================================================
-- SECURITY DEFINER RPCs for owner/admin to read sensitive cols
-- (client SDK callable; bypasses column REVOKE)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_employee_sensitive(_employee_id uuid)
RETURNS TABLE (
  id uuid, salary numeric, salary_type text, bank_name text, bank_account text,
  tax_id text, pan_number text, aadhaar_last4 text, uan_number text, esic_ip_number text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.salary, e.salary_type, e.bank_name, e.bank_account,
         e.tax_id, e.pan_number, e.aadhaar_last4, e.uan_number, e.esic_ip_number
  FROM public.employees e
  WHERE e.id = _employee_id
    AND public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.get_contract_financials(_contract_id uuid)
RETURNS TABLE (
  id uuid, salary numeric, base_salary numeric, commission_percentage numeric,
  terms jsonb, contract_variables jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT c.id, c.salary, c.base_salary, c.commission_percentage, c.terms, c.contract_variables
  FROM public.contracts c
  WHERE c.id = _contract_id
    AND public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.get_hr_settings_admin(_branch_id uuid)
RETURNS SETOF public.hr_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.hr_settings
  WHERE (_branch_id IS NULL OR branch_id = _branch_id OR branch_id IS NULL)
    AND public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.get_profile_government_id(_profile_id uuid)
RETURNS TABLE (id uuid, government_id_type text, government_id_number text, government_id_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, p.government_id_type, p.government_id_number, p.government_id_verified
  FROM public.profiles p
  WHERE p.id = _profile_id
    AND public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.get_trainer_government_id(_trainer_id uuid)
RETURNS TABLE (id uuid, government_id_type text, government_id_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.id, t.government_id_type, t.government_id_number
  FROM public.trainers t
  WHERE t.id = _trainer_id
    AND public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]);
$$;

GRANT EXECUTE ON FUNCTION public.get_employee_sensitive(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contract_financials(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hr_settings_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_government_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_trainer_government_id(uuid) TO authenticated;
