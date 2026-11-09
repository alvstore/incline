CREATE OR REPLACE FUNCTION public.payroll_adjust_item(p_item_id uuid, p_patch jsonb, p_reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF public.rpc_guard_applies('payroll_adjust_item') AND NOT EXISTS (
    SELECT 1 FROM public.payroll_items i JOIN public.payroll_runs r ON r.id=i.run_id
    WHERE i.id=p_item_id AND public._pt_is_branch_manager(auth.uid(),COALESCE(r.branch_id, public.staff_primary_branch(i.user_id)))
    AND (i.user_id<>auth.uid() OR public._gate_is_owner_admin())
  ) THEN RAISE EXCEPTION 'Not authorised for this payroll item' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.payroll_items WHERE id=p_item_id FOR UPDATE;
  -- Guard on the slip's own status: a paid run can still contain an unpaid slip.
  IF EXISTS (SELECT 1 FROM public.payroll_items WHERE id=p_item_id AND status IN ('processed','paid','cancelled')) THEN RAISE EXCEPTION 'This salary slip is already saved, paid or discarded and cannot be changed'; END IF;
  IF NOT (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  IF COALESCE(p_reason,'') = '' THEN RAISE EXCEPTION 'Reason is required for adjustments'; END IF;
  SELECT to_jsonb(pi) INTO v_before FROM public.payroll_items pi WHERE id = p_item_id;
  UPDATE public.payroll_items SET
      final_base = COALESCE((p_patch->>'final_base')::numeric, final_base),
      final_pt_commission = COALESCE((p_patch->>'final_pt_commission')::numeric, final_pt_commission),
      final_ot = COALESCE((p_patch->>'final_ot')::numeric, final_ot),
      final_bonus = COALESCE((p_patch->>'final_bonus')::numeric, final_bonus),
      final_deductions = COALESCE((p_patch->>'final_deductions')::numeric, final_deductions),
      final_advance = COALESCE((p_patch->>'final_advance')::numeric, final_advance),
      final_penalty = COALESCE((p_patch->>'final_penalty')::numeric, final_penalty),
      adjustment_reason = p_reason, status = 'draft', updated_at = now()
    WHERE id = p_item_id;
  UPDATE public.payroll_items SET
    final_gross = final_base + final_pt_commission + final_ot + final_bonus,
    final_net = (final_base + final_pt_commission + final_ot + final_bonus) - (final_deductions + final_advance + final_penalty)
    WHERE id = p_item_id;
  SELECT to_jsonb(pi) INTO v_after FROM public.payroll_items pi WHERE id = p_item_id;
  INSERT INTO public.payroll_audit (run_id, item_id, actor_id, action, before_data, after_data, reason)
  SELECT run_id, id, auth.uid(), 'item_adjusted', v_before, v_after, p_reason FROM public.payroll_items WHERE id = p_item_id;
END;
$function$;

-- Run status follows its slips: paid only when every live slip is paid.
CREATE OR REPLACE FUNCTION public.payroll_sync_run_status_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_open int; v_paid int; v_status text;
BEGIN
  SELECT count(*) FILTER (WHERE status NOT IN ('paid','cancelled')), count(*) FILTER (WHERE status='paid')
    INTO v_open, v_paid FROM public.payroll_items WHERE run_id=NEW.run_id;
  SELECT status INTO v_status FROM public.payroll_runs WHERE id=NEW.run_id;
  IF v_open=0 AND v_paid>0 AND v_status IS DISTINCT FROM 'paid' THEN
    UPDATE public.payroll_runs SET status='paid' WHERE id=NEW.run_id;
  ELSIF v_open>0 AND v_status='paid' THEN
    UPDATE public.payroll_runs SET status='approved' WHERE id=NEW.run_id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.payroll_sync_run_status_trg() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payroll_items_sync_run_status ON public.payroll_items;
CREATE TRIGGER payroll_items_sync_run_status AFTER UPDATE OF status ON public.payroll_items
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.payroll_sync_run_status_trg();

-- Backfill: paid runs that still hold an unpaid slip go back to approved.
UPDATE public.payroll_runs r SET status='approved'
 WHERE r.status='paid' AND EXISTS (SELECT 1 FROM public.payroll_items i WHERE i.run_id=r.id AND i.status NOT IN ('paid','cancelled'));

CREATE OR REPLACE FUNCTION public.payroll_discard_slips(p_item_ids uuid[], p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF public.rpc_guard_applies('payroll_discard_slips') AND NOT public._gate_is_owner_admin() THEN
    RAISE EXCEPTION 'Only owners/admins can discard salary slips' USING ERRCODE='42501'; END IF;
  IF COALESCE(trim(p_reason),'')='' THEN RAISE EXCEPTION 'Reason required'; END IF;
  INSERT INTO public.payroll_audit(run_id,item_id,actor_id,action,reason,before_data)
  SELECT i.run_id,i.id,auth.uid(),'slip_discarded',p_reason,to_jsonb(i) FROM public.payroll_items i
   WHERE i.id=ANY(p_item_ids) AND i.status IN ('draft','approved');
  UPDATE public.payroll_items SET status='cancelled', adjustment_reason=p_reason, updated_at=now()
   WHERE id=ANY(p_item_ids) AND status IN ('draft','approved');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.payroll_discard_slips(uuid[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payroll_discard_slips(uuid[],text) TO authenticated, service_role;