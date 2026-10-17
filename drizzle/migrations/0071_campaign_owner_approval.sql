ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE OR REPLACE FUNCTION public.tg_campaign_approval_required()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Campaigns created by anyone other than an owner/admin need owner/admin approval.
  IF auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    NEW.approval_required := true;
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_campaign_approval_required() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_campaign_approval_required ON public.campaigns;
CREATE TRIGGER trg_campaign_approval_required BEFORE INSERT ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_campaign_approval_required();

-- Non-owner edits to the message/audience reset any approval.
CREATE OR REPLACE FUNCTION public.tg_campaign_approval_reset()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approval_required IS DISTINCT FROM OLD.approval_required THEN
      NEW.approved_at := OLD.approved_at; NEW.approved_by := OLD.approved_by;
      NEW.approval_required := OLD.approval_required;
    END IF;
    IF to_jsonb(NEW) - ARRAY['status','updated_at','sent_count','failed_count','delivered_count','read_count','last_run_at','approved_at','approved_by','approval_required']
       IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status','updated_at','sent_count','failed_count','delivered_count','read_count','last_run_at','approved_at','approved_by','approval_required'] THEN
      NEW.approval_required := true; NEW.approved_at := NULL; NEW.approved_by := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_campaign_approval_reset() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_campaign_approval_reset ON public.campaigns;
CREATE TRIGGER trg_campaign_approval_reset BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_campaign_approval_reset();

CREATE OR REPLACE FUNCTION public.approve_campaign(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_branch uuid;
BEGIN
  IF public.rpc_guard_applies('approve_campaign')
     AND NOT public.has_any_role(v_uid, ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only owners or admins can approve broadcasts' USING ERRCODE = '42501';
  END IF;
  UPDATE public.campaigns SET approved_by = v_uid, approved_at = now()
   WHERE id = p_campaign_id RETURNING branch_id INTO v_branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Campaign not found'; END IF;
  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, action_description)
  VALUES (v_branch, v_uid, 'APPROVE', 'campaigns', p_campaign_id, 'Broadcast approved for sending');
  RETURN jsonb_build_object('success', true);
END $$;
REVOKE EXECUTE ON FUNCTION public.approve_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_campaign(uuid) TO authenticated;