ALTER TABLE public.membership_freeze_history ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'plan', ADD COLUMN IF NOT EXISTS baseline_end_date date, ADD COLUMN IF NOT EXISTS applied_at timestamptz, ADD COLUMN IF NOT EXISTS resumed_at timestamptz, ADD COLUMN IF NOT EXISTS actual_days_frozen integer, ADD COLUMN IF NOT EXISTS invoice_id uuid;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS plan_freeze_days_used integer;
ALTER TABLE public.branch_settings ADD COLUMN IF NOT EXISTS freeze_exceptions_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.branch_settings.freeze_exceptions_enabled IS 'Freeze exception kill switch. Owner: membership operations. Default off; disables new paid/override exceptions, never approved freezes or resume.';
UPDATE public.memberships SET plan_freeze_days_used=COALESCE(total_freeze_days_used,0) WHERE plan_freeze_days_used IS NULL;
UPDATE public.membership_freeze_history h SET baseline_end_date=COALESCE((SELECT (a.old_data->>'end_date')::date FROM public.audit_logs a WHERE a.record_id=m.id AND a.old_data->>'status'='active' AND a.new_data->>'status'='frozen' ORDER BY a.created_at DESC LIMIT 1),m.end_date), applied_at=COALESCE(h.approved_at,h.created_at),mode=CASE WHEN COALESCE(p.max_freeze_days,0)=0 AND COALESCE(h.fee_charged,0)=0 THEN 'override' WHEN COALESCE(h.fee_charged,0)>0 THEN 'paid' ELSE 'plan' END FROM public.memberships m JOIN public.membership_plans p ON p.id=m.plan_id WHERE h.membership_id=m.id AND m.status='frozen' AND h.status='approved' AND h.baseline_end_date IS NULL AND h.id=(SELECT h2.id FROM public.membership_freeze_history h2 WHERE h2.membership_id=m.id AND h2.status='approved' ORDER BY h2.created_at DESC LIMIT 1);
CREATE INDEX IF NOT EXISTS freeze_open_due_idx ON public.membership_freeze_history(start_date,end_date) WHERE status='approved' AND resumed_at IS NULL;
CREATE OR REPLACE FUNCTION public._apply_membership_freeze(p_freeze_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE h public.membership_freeze_history%ROWTYPE; m public.memberships%ROWTYPE; s public.branch_settings%ROWTYPE; allowance int; today date:=timezone('Asia/Kolkata',now())::date; inv uuid;
BEGIN
 SELECT * INTO h FROM membership_freeze_history WHERE id=p_freeze_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Freeze record not found'; END IF;
 SELECT * INTO m FROM memberships WHERE id=h.membership_id FOR UPDATE;
 SELECT * INTO h FROM membership_freeze_history WHERE id=p_freeze_id FOR UPDATE;
 IF h.applied_at IS NOT NULL THEN RETURN; END IF;
 IF h.status<>'approved' OR h.resumed_at IS NOT NULL THEN RAISE EXCEPTION 'Freeze is not approved'; END IF;
 IF m.status<>'active' OR m.start_date>today OR m.end_date<today THEN RAISE EXCEPTION 'An active, valid membership is required'; END IF;
 IF h.days_frozen IS NULL OR h.days_frozen<1 OR h.days_frozen>365 THEN RAISE EXCEPTION 'Invalid freeze duration'; END IF;
 IF length(btrim(COALESCE(h.reason,'')))<6 THEN RAISE EXCEPTION 'A reason of at least 6 characters is required'; END IF;
 SELECT COALESCE(max_freeze_days,0) INTO allowance FROM membership_plans WHERE id=m.plan_id;
 IF h.mode='plan' AND h.days_frozen>GREATEST(0,allowance-COALESCE(m.plan_freeze_days_used,m.total_freeze_days_used,0)) THEN RAISE EXCEPTION 'Freeze exceeds remaining plan days; request a paid or management exception'; END IF;
 SELECT * INTO s FROM branch_settings WHERE branch_id=m.branch_id;
 IF NOT FOUND THEN SELECT * INTO s FROM branch_settings WHERE branch_id IS NULL ORDER BY created_at DESC LIMIT 1; END IF;
 IF h.mode<>'override' AND (h.days_frozen<COALESCE(s.freeze_min_days,1) OR h.days_frozen>COALESCE(s.freeze_max_days,30)) THEN RAISE EXCEPTION 'Freeze duration is outside branch policy'; END IF;
 IF h.start_date>today THEN RETURN; END IF;
 UPDATE membership_freeze_history SET start_date=today,end_date=today+h.days_frozen-1,baseline_end_date=m.end_date,applied_at=now() WHERE id=h.id;
 IF h.mode='paid' AND COALESCE(h.fee_charged,0)>0 AND h.invoice_id IS NULL THEN
  INSERT INTO invoices(branch_id,member_id,subtotal,tax_amount,total_amount,amount_paid,status,due_date,invoice_type,notes) VALUES(m.branch_id,m.member_id,h.fee_charged,0,h.fee_charged,0,'pending',today,'freeze_fee','Approved membership freeze fee') RETURNING id INTO inv;
  INSERT INTO invoice_items(invoice_id,description,unit_price,quantity,tax_rate,tax_amount,total_amount,reference_type,reference_id) VALUES(inv,'Membership freeze fee',h.fee_charged,1,0,0,h.fee_charged,'freeze_fee',h.id);
  UPDATE membership_freeze_history SET invoice_id=inv WHERE id=h.id;
 END IF;
 UPDATE memberships SET status='frozen' WHERE id=m.id;
END $$;
REVOKE ALL ON FUNCTION public._apply_membership_freeze(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._apply_membership_freeze(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.auto_freeze_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NEW.status='approved' AND OLD.status IS DISTINCT FROM 'approved' THEN PERFORM public._apply_membership_freeze(NEW.id); END IF; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.auto_freeze_membership() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_freeze_membership() TO service_role;
CREATE OR REPLACE FUNCTION public.membership_freeze_context(p_membership_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.memberships%ROWTYPE; p public.membership_plans%ROWTYPE; s public.branch_settings%ROWTYPE; h public.membership_freeze_history%ROWTYPE; today date:=timezone('Asia/Kolkata',now())::date; actual int;
BEGIN
 SELECT * INTO m FROM memberships WHERE id=p_membership_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
 IF public.rpc_guard_applies('membership_freeze_context') THEN IF NOT public.is_branch_staff(m.branch_id,false) AND NOT EXISTS(SELECT 1 FROM members WHERE id=m.member_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF; END IF;
 SELECT * INTO p FROM membership_plans WHERE id=m.plan_id;
 SELECT * INTO s FROM branch_settings WHERE branch_id=m.branch_id;
 IF NOT FOUND THEN SELECT * INTO s FROM branch_settings WHERE branch_id IS NULL ORDER BY created_at DESC LIMIT 1; END IF;
 SELECT * INTO h FROM membership_freeze_history WHERE membership_id=m.id AND status IN ('pending','approved') AND resumed_at IS NULL ORDER BY created_at DESC LIMIT 1;
 actual:=CASE WHEN h.applied_at IS NOT NULL THEN GREATEST(0,LEAST(today,h.end_date+1)-h.start_date) ELSE 0 END;
 RETURN jsonb_build_object('membership',to_jsonb(m),'plan_name',p.name,'allowance',COALESCE(p.max_freeze_days,0),'used',COALESCE(m.plan_freeze_days_used,m.total_freeze_days_used,0),'remaining',GREATEST(0,COALESCE(p.max_freeze_days,0)-COALESCE(m.plan_freeze_days_used,m.total_freeze_days_used,0)),'min_days',COALESCE(s.freeze_min_days,1),'max_days',COALESCE(s.freeze_max_days,30),'fee',COALESCE(s.freeze_fee,0),'exceptions_enabled',COALESCE(s.freeze_exceptions_enabled,false),'can_override',public.is_branch_staff(m.branch_id,false) AND public.has_capability(auth.uid(),'freeze_membership'),'current_freeze',CASE WHEN h.id IS NOT NULL THEN to_jsonb(h) ELSE NULL END,'actual_days',actual,'resume_end_date',COALESCE(h.baseline_end_date,m.end_date)+actual,'today',today);
END $$;
REVOKE ALL ON FUNCTION public.membership_freeze_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.membership_freeze_context(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.request_or_freeze_membership(p_membership_id uuid,p_freeze_days integer,p_reason text,p_mode text DEFAULT 'plan',p_start_date date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.memberships%ROWTYPE; s public.branch_settings%ROWTYPE; allowance int; remaining int; hid uuid; aid uuid; staff boolean; privileged boolean; today date:=timezone('Asia/Kolkata',now())::date; starts date; fee numeric:=0; name text;
BEGIN
 SELECT * INTO m FROM memberships WHERE id=p_membership_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
 staff:=public.is_branch_staff(m.branch_id,false);
 IF public.rpc_guard_applies('request_or_freeze_membership') THEN IF NOT staff AND NOT EXISTS(SELECT 1 FROM members WHERE id=m.member_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF; END IF;
 privileged:=staff AND public.has_capability(auth.uid(),'freeze_membership');
 IF p_mode IS NULL OR p_mode NOT IN ('plan','paid','override') THEN RAISE EXCEPTION 'Choose a freeze type'; END IF;
 IF p_freeze_days IS NULL OR p_freeze_days<1 OR p_freeze_days>365 THEN RAISE EXCEPTION 'Duration must be 1–365 days'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<6 THEN RAISE EXCEPTION 'A reason of at least 6 characters is required'; END IF;
 starts:=COALESCE(p_start_date,today);
 IF m.status<>'active' OR m.start_date>today OR m.end_date<today OR starts<today OR starts>m.end_date THEN RAISE EXCEPTION 'Freeze must start during an active membership, today or later'; END IF;
 IF EXISTS(SELECT 1 FROM membership_freeze_history WHERE membership_id=m.id AND status IN ('pending','approved') AND resumed_at IS NULL) THEN RAISE EXCEPTION 'A freeze is already pending or approved'; END IF;
 SELECT COALESCE(max_freeze_days,0) INTO allowance FROM membership_plans WHERE id=m.plan_id;
 remaining:=GREATEST(0,allowance-COALESCE(m.plan_freeze_days_used,m.total_freeze_days_used,0));
 SELECT * INTO s FROM branch_settings WHERE branch_id=m.branch_id;
 IF NOT FOUND THEN SELECT * INTO s FROM branch_settings WHERE branch_id IS NULL ORDER BY created_at DESC LIMIT 1; END IF;
 IF p_mode='plan' AND p_freeze_days>remaining THEN RAISE EXCEPTION 'Freeze exceeds remaining plan days'; END IF;
 IF p_mode<>'plan' AND NOT COALESCE(s.freeze_exceptions_enabled,false) THEN RAISE EXCEPTION 'Freeze exceptions are currently disabled'; END IF;
 IF NOT staff AND p_mode<>'plan' THEN RAISE EXCEPTION 'Contact the front desk for an exception'; END IF;
 IF p_mode<>'override' AND (p_freeze_days<COALESCE(s.freeze_min_days,1) OR p_freeze_days>COALESCE(s.freeze_max_days,30)) THEN RAISE EXCEPTION 'Duration is outside branch freeze limits'; END IF;
 IF p_mode='paid' THEN fee:=COALESCE(s.freeze_fee,0); IF fee<=0 THEN RAISE EXCEPTION 'No paid freeze fee is configured; request a management exception'; END IF; END IF;
 SELECT p.full_name INTO name FROM members mm JOIN profiles p ON p.id=mm.user_id WHERE mm.id=m.member_id;
 INSERT INTO membership_freeze_history(membership_id,start_date,end_date,days_frozen,reason,fee_charged,mode,status,requested_by,approved_by,approved_at) VALUES(m.id,starts,starts+p_freeze_days-1,p_freeze_days,btrim(p_reason),fee,p_mode,CASE WHEN staff AND (p_mode='plan' OR privileged) THEN 'approved'::approval_status ELSE 'pending'::approval_status END,auth.uid(),CASE WHEN staff AND (p_mode='plan' OR privileged) THEN auth.uid() END,CASE WHEN staff AND (p_mode='plan' OR privileged) THEN now() END) RETURNING id INTO hid;
 IF staff AND (p_mode='plan' OR privileged) THEN PERFORM _apply_membership_freeze(hid); ELSE
  INSERT INTO approval_requests(branch_id,approval_type,reference_type,reference_id,requested_by,request_data) VALUES(m.branch_id,'membership_freeze','membership_freeze',hid,auth.uid(),jsonb_build_object('membershipId',m.id,'memberName',name,'startDate',starts,'endDate',starts+p_freeze_days-1,'daysFrozen',p_freeze_days,'reason',btrim(p_reason),'mode',p_mode,'feeCharged',fee,'remainingDays',remaining)) RETURNING id INTO aid;
 END IF;
 RETURN jsonb_build_object('success',true,'freeze_id',hid,'approval_id',aid,'status',CASE WHEN aid IS NOT NULL THEN 'pending' WHEN starts>today THEN 'scheduled' ELSE 'frozen' END);
END $$;
REVOKE ALL ON FUNCTION public.request_or_freeze_membership(uuid,integer,text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_or_freeze_membership(uuid,integer,text,text,date) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.resume_membership_freeze(p_membership_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m public.memberships%ROWTYPE; h public.membership_freeze_history%ROWTYPE; actual int; today date:=timezone('Asia/Kolkata',now())::date; ending date;
BEGIN
 SELECT * INTO m FROM memberships WHERE id=p_membership_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
 IF public.rpc_guard_applies('resume_membership_freeze') THEN PERFORM public.assert_branch_staff(m.branch_id,false,'Resume membership'); END IF;
 SELECT * INTO h FROM membership_freeze_history WHERE membership_id=m.id AND status='approved' AND applied_at IS NOT NULL AND resumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF m.status<>'frozen' OR h.id IS NULL OR h.baseline_end_date IS NULL THEN RAISE EXCEPTION 'No active freeze with a verified expiry snapshot'; END IF;
 actual:=GREATEST(0,LEAST(today,h.end_date+1)-h.start_date); ending:=h.baseline_end_date+actual;
 UPDATE membership_freeze_history SET resumed_at=now(),actual_days_frozen=actual WHERE id=h.id;
 UPDATE memberships SET status=CASE WHEN ending<today THEN 'expired'::membership_status ELSE 'active'::membership_status END,end_date=ending,total_freeze_days_used=COALESCE(total_freeze_days_used,0)+actual,plan_freeze_days_used=COALESCE(plan_freeze_days_used,0)+CASE WHEN h.mode='plan' THEN actual ELSE 0 END WHERE id=m.id;
 RETURN jsonb_build_object('success',true,'membership_id',m.id,'actual_days',actual,'new_end_date',ending);
END $$;
REVOKE ALL ON FUNCTION public.resume_membership_freeze(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resume_membership_freeze(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.freeze_membership(p_membership_id uuid,p_freeze_days integer,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE m public.memberships%ROWTYPE; BEGIN IF public.rpc_guard_applies('freeze_membership') THEN SELECT * INTO m FROM memberships WHERE id=p_membership_id; IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF; PERFORM public.assert_branch_staff(m.branch_id,false,'Freeze membership'); END IF; RETURN public.request_or_freeze_membership(p_membership_id,p_freeze_days,p_reason,'plan',NULL); END $$;
REVOKE ALL ON FUNCTION public.freeze_membership(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.freeze_membership(uuid,integer,text) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.process_due_membership_freezes() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE r record; today date:=timezone('Asia/Kolkata',now())::date; BEGIN FOR r IN SELECT h.id,h.membership_id,h.applied_at,h.end_date FROM membership_freeze_history h WHERE h.status='approved' AND h.resumed_at IS NULL AND ((h.applied_at IS NULL AND h.start_date<=today) OR (h.applied_at IS NOT NULL AND h.end_date<today)) LOOP BEGIN IF r.applied_at IS NULL THEN PERFORM public._apply_membership_freeze(r.id); ELSE PERFORM public.resume_membership_freeze(r.membership_id); END IF; EXCEPTION WHEN OTHERS THEN PERFORM public.log_error_event('membership_freeze_processing',SQLERRM,'error','membership_freeze',jsonb_build_object('freeze_id',r.id)); END; END LOOP; END $$;
REVOKE ALL ON FUNCTION public.process_due_membership_freezes() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_due_membership_freezes() TO service_role;
SELECT cron.schedule('membership-freeze-due','5 18 * * *',$job$SELECT public.process_due_membership_freezes() WHERE EXISTS(SELECT 1 FROM public.membership_freeze_history WHERE status='approved' AND resumed_at IS NULL AND ((applied_at IS NULL AND start_date<=timezone('Asia/Kolkata',now())::date) OR (applied_at IS NOT NULL AND end_date<timezone('Asia/Kolkata',now())::date)));$job$);
DO $migration$ DECLARE f text; old_block text; new_block text; BEGIN
 SELECT pg_get_functiondef('public.process_approval_request(uuid,text,text)'::regprocedure) INTO f;
 old_block := $old$      UPDATE public.membership_freeze_history
      SET status = 'approved', approved_by = auth.uid(), approved_at = now()
      WHERE id = _req.reference_id;
      IF _membership_id IS NOT NULL THEN
        UPDATE public.memberships SET status = 'frozen' WHERE id = _membership_id;
      END IF;

    ELSIF _req.reference_type = 'membership_unfreeze' THEN
      IF _membership_id IS NOT NULL THEN
        SELECT * INTO _ms FROM public.memberships WHERE id = _membership_id FOR UPDATE;
        IF FOUND THEN
          SELECT COALESCE(SUM(GREATEST(0, (COALESCE(end_date, _today) - start_date)::int)), 0)
          INTO _frozen_days
          FROM public.membership_freeze_history
          WHERE membership_id = _membership_id AND status = 'approved';
          UPDATE public.memberships
          SET status = 'active', end_date = (_ms.end_date + _frozen_days)
          WHERE id = _membership_id;
        END IF;
      END IF;$old$;
 new_block := $new$      IF NOT EXISTS(SELECT 1 FROM public.membership_freeze_history WHERE id=_req.reference_id AND membership_id=_membership_id AND status='pending') THEN RAISE EXCEPTION 'Freeze request needs a duration and linked freeze record; ask the desk to resubmit'; END IF;
      UPDATE public.membership_freeze_history SET status='approved',approved_by=auth.uid(),approved_at=now() WHERE id=_req.reference_id;
      PERFORM public._apply_membership_freeze(_req.reference_id);
    ELSIF _req.reference_type = 'membership_unfreeze' THEN
      PERFORM public.resume_membership_freeze(_membership_id);$new$;
 IF strpos(f,old_block)=0 THEN RAISE EXCEPTION 'Approval function changed; migration requires review'; END IF;
 f:=replace(f,old_block,new_block);
 f:=replace(f,'  IF NOT has_any_role(auth.uid(), ARRAY[''owner''::app_role, ''admin''::app_role, ''manager''::app_role]) THEN','  IF public.rpc_guard_applies(''process_approval_request'') AND NOT public.has_capability(auth.uid(),''freeze_membership'') THEN');
 f:=replace(f,'SET status = ''approved'', reviewed_by','SET side_effects_committed_at=now(), status = ''approved'', reviewed_by');
 EXECUTE f;
END $migration$;
REVOKE ALL ON FUNCTION public.process_approval_request(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.process_approval_request(uuid,text,text) TO authenticated,service_role;