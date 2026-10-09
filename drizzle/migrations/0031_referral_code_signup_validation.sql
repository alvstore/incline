CREATE TABLE IF NOT EXISTS public.referral_code_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_key text NOT NULL,
  ok boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.referral_code_attempts TO service_role;
ALTER TABLE public.referral_code_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No client access to referral attempts" ON public.referral_code_attempts FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE INDEX IF NOT EXISTS referral_code_attempts_key_time_idx ON public.referral_code_attempts (rate_key, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS referrals_one_per_referred_member_uidx ON public.referrals (referred_member_id) WHERE referred_member_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_referral_enabled(p_branch_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- guard-exempt: returns only a boolean branch toggle, no personal data
  SELECT COALESCE((SELECT is_active FROM public.referral_settings WHERE branch_id = p_branch_id ORDER BY updated_at DESC NULLS LAST LIMIT 1), false);
$$;
REVOKE ALL ON FUNCTION public.get_referral_enabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_enabled(uuid) TO anon, authenticated, service_role;

-- Core check shared by the visitor RPC and the register-member function.
CREATE OR REPLACE FUNCTION public._resolve_referral_code(p_code text, p_branch_id uuid, p_phone text, p_email text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_phone text; v_email text; v_code text := upper(btrim(coalesce(p_code,'')));
BEGIN
  -- guard-exempt: internal helper; EXECUTE revoked from PUBLIC/anon/authenticated below
  IF v_code = '' OR length(v_code) > 32 OR NOT public.get_referral_enabled(p_branch_id) THEN RETURN NULL; END IF;
  SELECT m.id, p.phone, lower(p.email) INTO v_id, v_phone, v_email
  FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE upper(m.member_code) = v_code AND m.branch_id = p_branch_id AND m.status = 'active' LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF p_phone IS NOT NULL AND v_phone IS NOT NULL AND right(regexp_replace(v_phone,'\D','','g'),10) = right(regexp_replace(p_phone,'\D','','g'),10) THEN RETURN NULL; END IF;
  IF p_email IS NOT NULL AND v_email IS NOT NULL AND v_email = lower(btrim(p_email)) THEN RETURN NULL; END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._resolve_referral_code(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._resolve_referral_code(text, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.validate_referral_code(p_code text, p_branch_id uuid, p_phone text DEFAULT NULL, p_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_name text; v_ip text; v_key text; v_fails int;
BEGIN
  -- guard-exempt: visitor sign-up check; rate-limited, returns only valid flag and first name + initial
  IF NOT public.get_referral_enabled(p_branch_id) THEN RETURN jsonb_build_object('valid', false, 'reason', 'disabled'); END IF;
  BEGIN v_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for',''), ',', 1);
  EXCEPTION WHEN others THEN v_ip := ''; END;
  v_key := coalesce(nullif(right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10),''), 'ip:' || coalesce(nullif(v_ip,''),'unknown'));
  SELECT count(*) INTO v_fails FROM public.referral_code_attempts
   WHERE rate_key IN (v_key, 'ip:' || coalesce(nullif(v_ip,''),'unknown')) AND NOT ok AND created_at > now() - interval '15 minutes';
  IF v_fails >= 8 THEN RETURN jsonb_build_object('valid', false, 'reason', 'rate_limited'); END IF;
  v_id := public._resolve_referral_code(p_code, p_branch_id, p_phone, p_email);
  INSERT INTO public.referral_code_attempts(rate_key, ok) VALUES (v_key, v_id IS NOT NULL);
  IF v_ip <> '' AND v_key <> 'ip:' || v_ip THEN INSERT INTO public.referral_code_attempts(rate_key, ok) VALUES ('ip:' || v_ip, v_id IS NOT NULL); END IF;
  IF v_id IS NULL THEN RETURN jsonb_build_object('valid', false, 'reason', 'invalid'); END IF;
  SELECT btrim(split_part(btrim(coalesce(p.full_name,'')), ' ', 1) || ' ' || coalesce(left(nullif(split_part(btrim(p.full_name), ' ', 2),''),1) || '.', ''))
    INTO v_name FROM public.members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.id = v_id;
  RETURN jsonb_build_object('valid', true, 'referrer_display', coalesce(nullif(v_name,''), 'an Incline member'));
END $$;
REVOKE ALL ON FUNCTION public.validate_referral_code(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_referral_code(text, uuid, text, text) TO anon, authenticated, service_role;