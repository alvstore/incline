
-- Per-branch gate mode flag: legacy | shadow | enforce (default legacy)
CREATE OR REPLACE FUNCTION public.gate_tier_mode(_branch_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT value #>> '{}' FROM public.settings WHERE key='gate_tier_mode' AND branch_id = _branch_id LIMIT 1),
    (SELECT value #>> '{}' FROM public.settings WHERE key='gate_tier_mode' AND branch_id IS NULL LIMIT 1),
    'legacy');
$$;
REVOKE EXECUTE ON FUNCTION public.gate_tier_mode(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_tier_mode(uuid) TO authenticated, service_role;

-- Overdue amounts split by bill line type (mixed bills split proportionally)
-- guard-exempt: internal helper, EXECUTE granted to service_role only
CREATE OR REPLACE FUNCTION public.member_overdue_breakdown(_member_id uuid, _grace int)
RETURNS TABLE(base_due numeric, pt_due numeric, store_due numeric, addon_due numeric, oldest_base date, oldest_any date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH inv AS (
    SELECT i.id, GREATEST(i.total_amount - COALESCE(i.amount_paid,0),0) AS due,
           COALESCE(i.payment_due_date, i.due_date) AS dd
    FROM public.invoices i
    WHERE i.member_id = _member_id
      AND i.status IN ('pending','partial','overdue')
      AND COALESCE(i.total_amount,0) - COALESCE(i.amount_paid,0) > 0
      AND COALESCE(i.payment_due_date, i.due_date) IS NOT NULL
      AND COALESCE(i.payment_due_date, i.due_date) + (_grace || ' days')::interval < CURRENT_DATE
  ), lines AS (
    SELECT inv.id, inv.due, inv.dd,
      CASE
        WHEN ii.reference_type = 'pt_package' THEN 'pt'
        WHEN ii.reference_type = 'product' THEN 'store'
        WHEN ii.reference_type IN ('benefit_package','locker') THEN 'addon'
        ELSE 'base' END AS kind,
      COALESCE(ii.total_amount,0) AS amt,
      SUM(COALESCE(ii.total_amount,0)) OVER (PARTITION BY inv.id) AS inv_amt,
      COUNT(*) OVER (PARTITION BY inv.id) AS n
    FROM inv LEFT JOIN public.invoice_items ii ON ii.invoice_id = inv.id
  ), share AS (
    SELECT kind, dd, CASE WHEN inv_amt > 0 THEN due * amt / inv_amt ELSE due / n END AS part FROM lines
  )
  SELECT COALESCE(SUM(part) FILTER (WHERE kind='base'),0),
         COALESCE(SUM(part) FILTER (WHERE kind='pt'),0),
         COALESCE(SUM(part) FILTER (WHERE kind='store'),0),
         COALESCE(SUM(part) FILTER (WHERE kind='addon'),0),
         MIN(dd) FILTER (WHERE kind='base'),
         MIN(dd)
  FROM share;
$$;
REVOKE EXECUTE ON FUNCTION public.member_overdue_breakdown(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_overdue_breakdown(uuid,int) TO service_role;

-- member_access_status: same contract, additive fields. In 'enforce' mode only
-- base-membership dues block; PT/store/add-on dues become AMBER.
CREATE OR REPLACE FUNCTION public.member_access_status(_member_id uuid, _branch_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_branch uuid; v_block boolean := true; v_grace int := 0; v_mode text;
  b record; v_total numeric; v_blocking numeric; v_oldest date; v_days int := 0; v_tier text;
BEGIN
  SELECT branch_id INTO v_branch FROM public.members WHERE id = _member_id;
  v_branch := COALESCE(_branch_id, v_branch);
  SELECT COALESCE(bs.block_access_on_overdue, true), COALESCE(bs.overdue_grace_days, 0)
    INTO v_block, v_grace FROM public.branch_settings bs WHERE bs.branch_id = v_branch;
  IF NOT FOUND THEN v_block := true; v_grace := 0; END IF;
  v_mode := public.gate_tier_mode(v_branch);

  SELECT * INTO b FROM public.member_overdue_breakdown(_member_id, v_grace);
  v_total := b.base_due + b.pt_due + b.store_due + b.addon_due;
  IF v_mode = 'enforce' THEN v_blocking := b.base_due; v_oldest := b.oldest_base;
  ELSE v_blocking := v_total; v_oldest := b.oldest_any; END IF;
  IF v_oldest IS NOT NULL THEN v_days := GREATEST((CURRENT_DATE - v_oldest)::int, 0); END IF;

  v_tier := CASE WHEN b.base_due > 0 AND v_block THEN 'red'
                 WHEN (b.pt_due + b.store_due + b.addon_due) > 0 THEN 'amber'
                 ELSE 'green' END;

  RETURN jsonb_build_object(
    'allowed', NOT (v_blocking > 0 AND v_block),
    'reason', CASE WHEN v_blocking > 0 AND v_block THEN 'dues_overdue' END,
    'outstanding_amount', ROUND(v_blocking,2),
    'days_overdue', v_days,
    'oldest_due_date', v_oldest,
    'blocking_enabled', v_block,
    'mode', v_mode,
    'tier', v_tier,
    'base_due', ROUND(b.base_due,2), 'pt_due', ROUND(b.pt_due,2),
    'store_due', ROUND(b.store_due,2), 'addon_due', ROUND(b.addon_due,2));
END;
$function$;

-- Front desk alert feed
CREATE TABLE public.front_desk_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('red','amber')),
  mode text NOT NULL DEFAULT 'shadow',
  reasons text[] NOT NULL DEFAULT '{}',
  base_due numeric NOT NULL DEFAULT 0, pt_due numeric NOT NULL DEFAULT 0,
  store_due numeric NOT NULL DEFAULT 0, addon_due numeric NOT NULL DEFAULT 0,
  scan_count int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  acknowledged_by uuid, acknowledged_at timestamptz, resolved_at timestamptz,
  alert_day date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, branch_id, alert_day)
);
CREATE INDEX front_desk_alerts_branch_open_idx ON public.front_desk_alerts (branch_id, alert_day DESC) WHERE status <> 'resolved';
GRANT SELECT ON public.front_desk_alerts TO authenticated;
GRANT ALL ON public.front_desk_alerts TO service_role;
ALTER TABLE public.front_desk_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Branch staff read gate alerts" ON public.front_desk_alerts FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role(auth.uid(), ARRAY['owner','admin']::app_role[]))
      OR branch_id IN (SELECT public.managed_branch_ids(auth.uid()))
      OR branch_id = (SELECT public.get_user_branch(auth.uid())));
ALTER PUBLICATION supabase_realtime ADD TABLE public.front_desk_alerts;

-- Called by the gate webhook (service role) to record/refresh today's alert
-- guard-exempt: service_role only
CREATE OR REPLACE FUNCTION public.record_gate_alert(_member_id uuid, _branch_id uuid, _access jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_tier text := _access->>'tier'; v_reasons text[] := '{}';
BEGIN
  IF v_tier NOT IN ('red','amber') THEN RETURN NULL; END IF;
  IF (_access->>'base_due')::numeric > 0 THEN v_reasons := v_reasons || 'membership_dues'; END IF;
  IF (_access->>'pt_due')::numeric > 0 THEN v_reasons := v_reasons || 'pt_dues'; END IF;
  IF (_access->>'store_due')::numeric > 0 THEN v_reasons := v_reasons || 'store_dues'; END IF;
  IF (_access->>'addon_due')::numeric > 0 THEN v_reasons := v_reasons || 'addon_dues'; END IF;
  INSERT INTO public.front_desk_alerts AS a (branch_id, member_id, tier, mode, reasons, base_due, pt_due, store_due, addon_due)
  VALUES (_branch_id, _member_id, v_tier, COALESCE(_access->>'mode','shadow'), v_reasons,
    COALESCE((_access->>'base_due')::numeric,0), COALESCE((_access->>'pt_due')::numeric,0),
    COALESCE((_access->>'store_due')::numeric,0), COALESCE((_access->>'addon_due')::numeric,0))
  ON CONFLICT (member_id, branch_id, alert_day) DO UPDATE
    SET tier = EXCLUDED.tier, reasons = EXCLUDED.reasons, base_due = EXCLUDED.base_due,
        pt_due = EXCLUDED.pt_due, store_due = EXCLUDED.store_due, addon_due = EXCLUDED.addon_due,
        mode = EXCLUDED.mode, scan_count = a.scan_count + 1, updated_at = now(),
        status = CASE WHEN a.status = 'resolved' THEN 'open' ELSE a.status END
  RETURNING id INTO v_id;
  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, new_data, actor_name, action_description)
  VALUES (_branch_id, NULL, 'gate_tier_' || v_tier, 'members', _member_id,
    jsonb_build_object('tier', v_tier, 'mode', _access->>'mode', 'reasons', v_reasons,
      'base_due', _access->'base_due', 'pt_due', _access->'pt_due', 'store_due', _access->'store_due', 'addon_due', _access->'addon_due'),
    'System (gate)', 'Gate decision ' || upper(v_tier));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_gate_alert(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_gate_alert(uuid,uuid,jsonb) TO service_role;

-- Staff acknowledge / resolve
CREATE OR REPLACE FUNCTION public.update_gate_alert(_alert_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid; v_member uuid;
BEGIN
  IF _status NOT IN ('acknowledged','resolved') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT branch_id, member_id INTO v_branch, v_member FROM public.front_desk_alerts WHERE id = _alert_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
  IF public.rpc_guard_applies('update_gate_alert') THEN
    PERFORM public.assert_branch_staff(v_branch);
  END IF;
  UPDATE public.front_desk_alerts SET status = _status, updated_at = now(),
    acknowledged_by = COALESCE(acknowledged_by, auth.uid()),
    acknowledged_at = COALESCE(acknowledged_at, now()),
    resolved_at = CASE WHEN _status='resolved' THEN now() ELSE resolved_at END
  WHERE id = _alert_id;
  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, new_data, action_description)
  VALUES (v_branch, auth.uid(), 'gate_alert_' || _status, 'front_desk_alerts', _alert_id,
    jsonb_build_object('member_id', v_member, 'status', _status), 'Gate alert ' || _status);
END $$;
REVOKE EXECUTE ON FUNCTION public.update_gate_alert(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_gate_alert(uuid,text) TO authenticated, service_role;

-- What digital actions are locked for a member (own member or branch staff)
CREATE OR REPLACE FUNCTION public.member_debt_locks(_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid; a jsonb; v_enf boolean;
BEGIN
  SELECT branch_id INTO v_branch FROM public.members WHERE id = _member_id;
  IF public.rpc_guard_applies('member_debt_locks') THEN
    IF NOT (public.is_own_member(_member_id) OR public.is_branch_staff(v_branch, true)) THEN
      RAISE EXCEPTION 'forbidden: member_debt_locks' USING ERRCODE = '42501';
    END IF;
  END IF;
  a := public.member_access_status(_member_id, v_branch);
  v_enf := (a->>'mode') = 'enforce';
  RETURN jsonb_build_object(
    'mode', a->>'mode', 'tier', a->>'tier',
    'pt_due', a->'pt_due', 'store_due', a->'store_due', 'addon_due', a->'addon_due', 'base_due', a->'base_due',
    'pt_locked', v_enf AND (a->>'pt_due')::numeric > 0,
    'store_locked', v_enf AND ((a->>'store_due')::numeric + (a->>'addon_due')::numeric) > 0,
    'addon_locked', v_enf AND ((a->>'store_due')::numeric + (a->>'addon_due')::numeric) > 0);
END $$;
REVOKE EXECUTE ON FUNCTION public.member_debt_locks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_debt_locks(uuid) TO authenticated, service_role;

-- Server-side lock: members cannot open new store/add-on bills while a
-- secondary bill is overdue (enforce mode only). Staff are not affected.
CREATE OR REPLACE FUNCTION public.tg_enforce_member_debt_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_path text := COALESCE(current_setting('request.path', true), ''); l jsonb;
BEGIN
  IF NEW.member_id IS NULL OR v_path NOT IN ('/rpc/purchase_benefit_credits','/rpc/create_pos_sale') THEN RETURN NEW; END IF;
  IF NOT public.is_own_member(NEW.member_id) THEN RETURN NEW; END IF;
  IF public.has_any_role(auth.uid(), ARRAY['owner','admin','manager','staff','trainer']::app_role[]) THEN RETURN NEW; END IF;
  l := public.member_debt_locks(NEW.member_id);
  IF (l->>'store_locked')::boolean THEN
    RAISE EXCEPTION 'payment_required: please clear your overdue bill before a new purchase' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_enforce_member_debt_lock() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_enforce_member_debt_lock BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_member_debt_lock();
