REVOKE INSERT, UPDATE, DELETE ON public.membership_freeze_history FROM authenticated;
CREATE POLICY member_read_freeze_history ON public.membership_freeze_history FOR SELECT TO authenticated USING (membership_id IN (SELECT m.id FROM public.memberships m JOIN public.members mm ON mm.id=m.member_id WHERE mm.user_id=(SELECT auth.uid())));
CREATE OR REPLACE FUNCTION public.set_membership_freeze_exceptions(p_branch_id uuid,p_enabled boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF public.rpc_guard_applies('set_membership_freeze_exceptions') THEN
  PERFORM public.assert_branch_staff(p_branch_id,false,'Change freeze exception policy');
  IF NOT public.has_capability(auth.uid(),'freeze_membership') THEN RAISE EXCEPTION 'Only management can change freeze exceptions' USING ERRCODE='42501'; END IF;
 END IF;
 IF p_branch_id IS NULL OR p_enabled IS NULL THEN RAISE EXCEPTION 'Select a branch and switch state'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('freeze_policy:'||p_branch_id::text));
 IF NOT EXISTS(SELECT 1 FROM public.branch_settings WHERE branch_id=p_branch_id) THEN
  INSERT INTO public.branch_settings(branch_id,freeze_min_days,freeze_max_days,freeze_fee,freeze_exceptions_enabled)
  SELECT p_branch_id,freeze_min_days,freeze_max_days,freeze_fee,p_enabled FROM public.branch_settings WHERE branch_id IS NULL ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN INSERT INTO public.branch_settings(branch_id,freeze_exceptions_enabled) VALUES(p_branch_id,p_enabled); END IF;
 ELSE UPDATE public.branch_settings SET freeze_exceptions_enabled=p_enabled WHERE branch_id=p_branch_id; END IF;
 INSERT INTO public.audit_logs(branch_id,user_id,action,table_name,record_id,new_data) VALUES(p_branch_id,auth.uid(),'FREEZE_EXCEPTION_POLICY','branch_settings',p_branch_id,jsonb_build_object('enabled',p_enabled));
END $$;
REVOKE ALL ON FUNCTION public.set_membership_freeze_exceptions(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_membership_freeze_exceptions(uuid,boolean) TO authenticated,service_role;