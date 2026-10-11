CREATE TABLE IF NOT EXISTS public.gate_rule_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid,
  setting text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  rechecked integer NOT NULL DEFAULT 0,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gate_rule_changes TO authenticated;
GRANT ALL ON public.gate_rule_changes TO service_role;
ALTER TABLE public.gate_rule_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read gate rule changes" ON public.gate_rule_changes FOR SELECT TO authenticated
  USING ((SELECT public.has_role(auth.uid(),'owner')) OR (SELECT public.has_role(auth.uid(),'admin')));

CREATE OR REPLACE FUNCTION public._gate_is_owner_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')
$$;
REVOKE EXECUTE ON FUNCTION public._gate_is_owner_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._gate_is_owner_admin() TO authenticated, service_role;

-- Members whose gate state disagrees with what their dues say
CREATE OR REPLACE FUNCTION public.gate_access_drift(_branch_id uuid DEFAULT NULL)
RETURNS TABLE(member_id uuid, member_code text, full_name text, branch_id uuid,
  hardware_access_status text, hardware_access_reason text, hardware_access_enabled boolean,
  expected text, base_due numeric, other_due numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('gate_access_drift') AND NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners or admins can review gate rules' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH c AS (
    SELECT m.id, m.member_code, p.full_name, m.branch_id, m.hardware_access_status, m.hardware_access_reason,
           m.hardware_access_enabled,
           public.member_access_status(m.id, m.branch_id) AS st
    FROM public.members m
    LEFT JOIN public.profiles p ON p.id = m.user_id
    WHERE m.status = 'active'
      AND (_branch_id IS NULL OR m.branch_id = _branch_id)
      AND EXISTS (SELECT 1 FROM public.memberships ms WHERE ms.member_id = m.id
                  AND ms.status = 'active' AND ms.start_date <= current_date AND ms.end_date >= current_date)
      AND (m.hardware_access_reason = 'dues' OR m.hardware_access_status IN ('active','blocked_overdue','revoked'))
  ), b AS (
    SELECT c.*, (SELECT x FROM public.member_overdue_breakdown(c.id, 0) x) AS bd FROM c
  )
  SELECT b.id, b.member_code, b.full_name, b.branch_id, b.hardware_access_status, b.hardware_access_reason,
         b.hardware_access_enabled,
         CASE WHEN (b.st->>'allowed')::boolean IS FALSE THEN 'locked' ELSE 'open' END,
         COALESCE((b.bd).base_due,0), COALESCE((b.bd).pt_due,0)+COALESCE((b.bd).store_due,0)+COALESCE((b.bd).addon_due,0)
  FROM b
  WHERE ((b.st->>'allowed')::boolean IS NOT FALSE
          AND b.hardware_access_reason = 'dues'
          AND (b.hardware_access_enabled = false OR b.hardware_access_status IN ('revoked','blocked_overdue')))
     OR ((b.st->>'allowed')::boolean IS FALSE AND b.hardware_access_status = 'active');
END $$;
REVOKE EXECUTE ON FUNCTION public.gate_access_drift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_access_drift(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gate_fix_member(_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_allowed boolean; v_branch uuid; v_reason text;
BEGIN
  IF public.rpc_guard_applies('gate_fix_member') AND NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners or admins can fix gate state' USING ERRCODE = '42501';
  END IF;
  SELECT branch_id, hardware_access_reason INTO v_branch, v_reason FROM public.members WHERE id = _member_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Member not found'); END IF;
  v_allowed := (public.member_access_status(_member_id, v_branch)->>'allowed')::boolean IS NOT FALSE;
  -- Only re-open a gate switch that was turned off because of dues, never a manual block
  IF v_allowed AND v_reason = 'dues' THEN
    UPDATE public.members SET hardware_access_enabled = true WHERE id = _member_id AND hardware_access_enabled = false;
  END IF;
  RETURN public.evaluate_member_access_state(_member_id, auth.uid(), 'gate rules re-check', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.gate_fix_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_fix_member(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gate_recheck_branch(_branch_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0; f int := 0;
BEGIN
  IF public.rpc_guard_applies('gate_recheck_branch') AND NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners or admins can re-check gates' USING ERRCODE = '42501';
  END IF;
  FOR r IN SELECT d.member_id FROM public.gate_access_drift(_branch_id) d LOOP
    BEGIN
      PERFORM public.gate_fix_member(r.member_id);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN f := f + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'queued', n, 'failed', f);
END $$;
REVOKE EXECUTE ON FUNCTION public.gate_recheck_branch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_recheck_branch(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gate_rules_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.rpc_guard_applies('gate_rules_overview') AND NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners or admins can view gate rules' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'global_mode', COALESCE((SELECT value #>> '{}' FROM public.settings WHERE key='gate_tier_mode' AND branch_id IS NULL), 'legacy'),
    'tz_lock', COALESCE((SELECT (value->>'enabled')::boolean FROM public.settings WHERE key='mips_tz_revoke_mode' AND branch_id IS NULL), false),
    'branches', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'name', b.name,
        'mode', public.gate_tier_mode(b.id),
        'override', (SELECT s.value #>> '{}' FROM public.settings s WHERE s.key='gate_tier_mode' AND s.branch_id=b.id)
      ) ORDER BY b.name) FROM public.branches b), '[]'::jsonb)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.gate_rules_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_rules_overview() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_gate_settings(_branch_id uuid DEFAULT NULL, _mode text DEFAULT NULL, _tz_lock boolean DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_res jsonb := '{}'::jsonb; v_n int := 0;
BEGIN
  IF public.rpc_guard_applies('set_gate_settings') AND NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Only owners or admins can change gate rules' USING ERRCODE = '42501';
  END IF;
  IF _mode IS NOT NULL THEN
    IF _mode NOT IN ('legacy','shadow','enforce') THEN RAISE EXCEPTION 'Invalid gate mode'; END IF;
    SELECT value INTO v_old FROM public.settings WHERE key='gate_tier_mode' AND branch_id IS NOT DISTINCT FROM _branch_id;
    IF v_old IS NULL OR v_old #>> '{}' <> _mode THEN
      IF _branch_id IS NULL THEN
        UPDATE public.settings SET value = to_jsonb(_mode) WHERE key='gate_tier_mode' AND branch_id IS NULL;
        IF NOT FOUND THEN INSERT INTO public.settings(key, value, branch_id) VALUES ('gate_tier_mode', to_jsonb(_mode), NULL); END IF;
      ELSE
        INSERT INTO public.settings(key, value, branch_id) VALUES ('gate_tier_mode', to_jsonb(_mode), _branch_id)
        ON CONFLICT (branch_id, key) DO UPDATE SET value = EXCLUDED.value;
      END IF;
      v_n := COALESCE((public.gate_recheck_branch(_branch_id)->>'queued')::int, 0);
      INSERT INTO public.gate_rule_changes(branch_id, setting, old_value, new_value, rechecked, actor_id)
        VALUES (_branch_id, 'gate_tier_mode', v_old, to_jsonb(_mode), v_n, auth.uid());
      v_res := v_res || jsonb_build_object('rechecked', v_n);
    END IF;
  END IF;
  IF _tz_lock IS NOT NULL THEN
    SELECT value INTO v_old FROM public.settings WHERE key='mips_tz_revoke_mode' AND branch_id IS NULL;
    UPDATE public.settings SET value = jsonb_build_object('enabled', _tz_lock) WHERE key='mips_tz_revoke_mode' AND branch_id IS NULL;
    IF NOT FOUND THEN INSERT INTO public.settings(key, value, branch_id) VALUES ('mips_tz_revoke_mode', jsonb_build_object('enabled', _tz_lock), NULL); END IF;
    INSERT INTO public.gate_rule_changes(branch_id, setting, old_value, new_value, actor_id)
      VALUES (NULL, 'mips_tz_revoke_mode', v_old, jsonb_build_object('enabled', _tz_lock), auth.uid());
  END IF;
  RETURN jsonb_build_object('success', true) || v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_gate_settings(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_gate_settings(uuid, text, boolean) TO authenticated, service_role;