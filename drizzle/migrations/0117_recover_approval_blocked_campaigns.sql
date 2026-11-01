CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_campaign public.campaigns%ROWTYPE;
BEGIN
  IF public.rpc_guard_applies('approve_campaign') AND NOT public.has_any_role(v_uid, ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only owners or admins can approve broadcasts' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  -- Only recover unsent one-shot campaigns demonstrably blocked by approval.
  -- Drafts, cancelled schedules, real send failures and recurring rules remain unchanged.
  IF v_campaign.approval_required AND v_campaign.approved_at IS NULL
     AND v_campaign.trigger_type IN ('send_now','scheduled')
     AND NOT EXISTS (SELECT 1 FROM public.campaign_recipients WHERE campaign_id = p_campaign_id)
     AND (v_campaign.status = 'sending' OR
          (v_campaign.status = 'failed' AND COALESCE(v_campaign.last_run_error,'') ILIKE '%approval%')) THEN
    UPDATE public.campaigns SET status = 'scheduled',
      scheduled_at = COALESCE(scheduled_at, now()), last_run_error = NULL
    WHERE id = p_campaign_id;
  END IF;
  UPDATE public.campaigns SET approved_by = v_uid, approved_at = now() WHERE id = p_campaign_id;
  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, action_description)
  VALUES (v_campaign.branch_id, v_uid, 'APPROVE', 'campaigns', p_campaign_id, 'Broadcast approved for sending');
  RETURN jsonb_build_object('success', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.approve_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid) TO authenticated, service_role;