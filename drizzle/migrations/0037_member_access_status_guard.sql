-- Direct-entry guard: own member or branch staff; nested calls (gate, check-in, sync) unaffected.
CREATE OR REPLACE FUNCTION public.member_access_status(_member_id uuid, _branch_id uuid DEFAULT NULL::uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_branch uuid; v_block boolean := true; v_grace int := 0; v_mode text;
  b record; v_total numeric; v_blocking numeric; v_oldest date; v_days int := 0; v_tier text;
BEGIN
  SELECT branch_id INTO v_branch FROM public.members WHERE id = _member_id;
  v_branch := COALESCE(_branch_id, v_branch);
  IF public.rpc_guard_applies('member_access_status') THEN
    IF NOT (public.is_own_member(_member_id) OR public.is_branch_staff(v_branch, true)) THEN
      RAISE EXCEPTION 'forbidden: member_access_status' USING ERRCODE = '42501';
    END IF;
  END IF;
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
