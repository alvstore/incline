ALTER TABLE public.membership_freeze_history ADD COLUMN IF NOT EXISTS fee_gst_rate numeric NOT NULL DEFAULT 0 CHECK (fee_gst_rate IN (0,18));
CREATE OR REPLACE FUNCTION public._apply_membership_freeze(p_freeze_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE h public.membership_freeze_history%ROWTYPE; m public.memberships%ROWTYPE; s public.branch_settings%ROWTYPE; allowance int; today date:=timezone('Asia/Kolkata',now())::date; inv uuid;
BEGIN
 SELECT * INTO h FROM membership_freeze_history WHERE id=p_freeze_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Freeze record not found'; END IF;
 SELECT * INTO m FROM memberships WHERE id=h.membership_id FOR UPDATE;
 SELECT * INTO h FROM membership_freeze_history WHERE id=p_freeze_id FOR UPDATE;
 IF h.applied_at IS NOT NULL THEN RETURN; END IF;
 IF h.status<>'approved' OR h.resumed_at IS NOT NULL THEN RAISE EXCEPTION 'Freeze is not approved'; END IF;
 IF m.status<>'active' OR m.start_date>today OR m.end_date<today THEN RAISE EXCEPTION 'An active, valid membership is required'; END IF;
 IF NOT h.is_open_ended AND (h.days_frozen IS NULL OR h.days_frozen<1 OR h.days_frozen>365) THEN RAISE EXCEPTION 'Invalid freeze duration'; END IF;
 IF length(btrim(COALESCE(h.reason,'')))<6 THEN RAISE EXCEPTION 'A reason of at least 6 characters is required'; END IF;
 SELECT COALESCE(max_freeze_days,0) INTO allowance FROM membership_plans WHERE id=m.plan_id;
 IF h.mode='plan' AND h.days_frozen>GREATEST(0,allowance-COALESCE(m.plan_freeze_days_used,m.total_freeze_days_used,0)) THEN RAISE EXCEPTION 'Freeze exceeds remaining plan days; request a paid or management exception'; END IF;
 SELECT * INTO s FROM branch_settings WHERE branch_id=m.branch_id;
 IF NOT FOUND THEN SELECT * INTO s FROM branch_settings WHERE branch_id IS NULL ORDER BY created_at DESC LIMIT 1; END IF;
 IF h.mode<>'override' AND (h.days_frozen<COALESCE(s.freeze_min_days,1) OR h.days_frozen>COALESCE(s.freeze_max_days,30)) THEN RAISE EXCEPTION 'Freeze duration is outside branch policy'; END IF;
 IF h.is_open_ended AND (h.mode<>'override' OR h.days_frozen IS NOT NULL OR h.end_date IS NOT NULL OR COALESCE(h.fee_charged,0)<>0) THEN RAISE EXCEPTION 'Open-ended freezes require a fee-free management exception'; END IF; IF h.mode NOT IN ('plan','paid','override') THEN RAISE EXCEPTION 'Invalid freeze type'; END IF;
 IF h.mode<>'plan' AND NOT COALESCE(s.freeze_exceptions_enabled,false) THEN RAISE EXCEPTION 'Freeze exceptions are currently disabled'; END IF;
 IF h.mode='paid' AND COALESCE(h.fee_charged,0)<=0 THEN RAISE EXCEPTION 'Paid freeze needs a fee above ₹0'; END IF;
 IF h.start_date>today THEN RETURN; END IF;
 UPDATE membership_freeze_history SET start_date=today,end_date=today+h.days_frozen-1,baseline_end_date=m.end_date,applied_at=now() WHERE id=h.id;
 IF h.mode='paid' AND COALESCE(h.fee_charged,0)>0 AND h.invoice_id IS NULL THEN
  INSERT INTO invoices(branch_id,member_id,invoice_number,subtotal,tax_amount,total_amount,amount_paid,status,due_date,invoice_type,notes,is_gst_invoice,gst_rate) VALUES(m.branch_id,m.member_id,NULL,h.fee_charged,round(h.fee_charged*COALESCE(h.fee_gst_rate,0)/100,2),h.fee_charged+round(h.fee_charged*COALESCE(h.fee_gst_rate,0)/100,2),0,'pending',today,'freeze_fee','Membership freeze fee',COALESCE(h.fee_gst_rate,0)>0,COALESCE(h.fee_gst_rate,0)) RETURNING id INTO inv;
  INSERT INTO invoice_items(invoice_id,description,unit_price,quantity,tax_rate,tax_amount,total_amount,reference_type,reference_id) VALUES(inv,'Membership freeze fee',h.fee_charged,1,COALESCE(h.fee_gst_rate,0),round(h.fee_charged*COALESCE(h.fee_gst_rate,0)/100,2),h.fee_charged+round(h.fee_charged*COALESCE(h.fee_gst_rate,0)/100,2),'freeze_fee',h.id);
  UPDATE membership_freeze_history SET invoice_id=inv WHERE id=h.id;
 END IF;
 UPDATE memberships SET status='frozen' WHERE id=m.id;
END $function$;
CREATE OR REPLACE FUNCTION public.request_or_freeze_membership(p_membership_id uuid, p_freeze_days integer, p_reason text, p_mode text, p_start_date date, p_fee numeric, p_gst boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE m public.memberships%ROWTYPE; s public.branch_settings%ROWTYPE; allowance int; remaining int; hid uuid; aid uuid; staff boolean; privileged boolean; today date:=timezone('Asia/Kolkata',now())::date; starts date; fee numeric:=0; name text; gst numeric:=0; inv uuid;
BEGIN
 SELECT * INTO m FROM memberships WHERE id=p_membership_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Membership not found'; END IF;
 staff:=public.is_branch_staff(m.branch_id,false);
 IF public.rpc_guard_applies('request_or_freeze_membership') THEN IF NOT staff AND NOT EXISTS(SELECT 1 FROM members WHERE id=m.member_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF; END IF;
 privileged:=staff AND public.has_capability(auth.uid(),'freeze_membership');
 IF p_mode IS NULL OR p_mode NOT IN ('plan','paid','override') THEN RAISE EXCEPTION 'Choose a freeze type'; END IF;
 IF (p_freeze_days IS NULL AND p_mode<>'override') OR p_freeze_days<1 OR p_freeze_days>365 THEN RAISE EXCEPTION 'Duration must be 1–365 days'; END IF;
 IF length(btrim(COALESCE(p_reason,'')))<6 THEN RAISE EXCEPTION 'A reason of at least 6 characters is required'; END IF;
 IF p_freeze_days IS NULL AND p_start_date IS NOT NULL AND p_start_date<>today THEN RAISE EXCEPTION 'Open-ended freezes start today; no scheduled date is allowed'; END IF; starts:=COALESCE(p_start_date,today);
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
 IF p_mode='paid' THEN fee:=round(COALESCE(p_fee,s.freeze_fee,0),2); IF fee<=0 OR fee>500000 THEN RAISE EXCEPTION 'Enter a freeze fee above ₹0'; END IF; IF COALESCE(p_gst,false) THEN gst:=18; END IF; END IF;
 SELECT p.full_name INTO name FROM members mm JOIN profiles p ON p.id=mm.user_id WHERE mm.id=m.member_id;
 INSERT INTO membership_freeze_history(membership_id,start_date,end_date,days_frozen,reason,fee_charged,fee_gst_rate,mode,is_open_ended,status,requested_by,approved_by,approved_at) VALUES(m.id,starts,starts+p_freeze_days-1,p_freeze_days,btrim(p_reason),fee,gst,p_mode,p_freeze_days IS NULL,CASE WHEN staff AND (p_mode='plan' OR privileged) THEN 'approved'::approval_status ELSE 'pending'::approval_status END,auth.uid(),CASE WHEN staff AND (p_mode='plan' OR privileged) THEN auth.uid() END,CASE WHEN staff AND (p_mode='plan' OR privileged) THEN now() END) RETURNING id INTO hid;
 IF staff AND (p_mode='plan' OR privileged) THEN PERFORM _apply_membership_freeze(hid); ELSE
  INSERT INTO approval_requests(branch_id,approval_type,reference_type,reference_id,requested_by,request_data) VALUES(m.branch_id,'membership_freeze','membership_freeze',hid,auth.uid(),jsonb_build_object('membershipId',m.id,'memberName',name,'startDate',starts,'endDate',starts+p_freeze_days-1,'daysFrozen',p_freeze_days,'isOpenEnded',p_freeze_days IS NULL,'reason',btrim(p_reason),'mode',p_mode,'feeCharged',fee,'gstRate',gst,'remainingDays',remaining)) RETURNING id INTO aid;
 END IF;
 SELECT invoice_id INTO inv FROM membership_freeze_history WHERE id=hid;
 RETURN jsonb_build_object('success',true,'freeze_id',hid,'invoice_id',inv,'approval_id',aid,'status',CASE WHEN aid IS NOT NULL THEN 'pending' WHEN starts>today THEN 'scheduled' ELSE 'frozen' END);
END $function$;
REVOKE ALL ON FUNCTION public.request_or_freeze_membership(uuid,integer,text,text,date,numeric,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_or_freeze_membership(uuid,integer,text,text,date,numeric,boolean) TO authenticated,service_role;