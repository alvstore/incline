CREATE TABLE public.locker_pricing_settings (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  medium_fee numeric NOT NULL DEFAULT 2500 CHECK (medium_fee >= 0),
  large_fee numeric NOT NULL DEFAULT 3500 CHECK (large_fee >= 0),
  gst_enabled boolean NOT NULL DEFAULT true,
  gst_rate numeric NOT NULL DEFAULT 18 CHECK (gst_rate >= 0 AND gst_rate <= 28),
  portal_requests_enabled boolean NOT NULL DEFAULT true,
  daily_use_note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.locker_pricing_settings TO authenticated;
GRANT ALL ON public.locker_pricing_settings TO service_role;
ALTER TABLE public.locker_pricing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signed-in users read locker pricing" ON public.locker_pricing_settings
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.locker_pricing_settings (branch_id) SELECT id FROM public.branches ON CONFLICT DO NOTHING;

-- Owner/admin (any branch) or branch manager updates pricing; every change audit-logged.
CREATE OR REPLACE FUNCTION public.update_locker_pricing_settings(
  p_branch_id uuid, p_medium_fee numeric, p_large_fee numeric, p_gst_enabled boolean,
  p_gst_rate numeric, p_portal_requests_enabled boolean, p_daily_use_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_old jsonb; v_new jsonb;
BEGIN
  IF public.rpc_guard_applies('update_locker_pricing_settings') THEN
    IF NOT (public.has_any_role(v_uid, ARRAY['owner','admin']::text[])
            OR (public.has_any_role(v_uid, ARRAY['manager']::text[]) AND public.manages_branch(v_uid, p_branch_id))) THEN
      RAISE EXCEPTION 'Not authorized to change locker pricing' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF p_medium_fee < 0 OR p_large_fee < 0 THEN RAISE EXCEPTION 'Fees cannot be negative'; END IF;
  IF p_gst_rate < 0 OR p_gst_rate > 28 THEN RAISE EXCEPTION 'GST rate must be between 0 and 28'; END IF;

  SELECT to_jsonb(s) INTO v_old FROM public.locker_pricing_settings s WHERE branch_id = p_branch_id;
  INSERT INTO public.locker_pricing_settings AS s (branch_id, medium_fee, large_fee, gst_enabled, gst_rate, portal_requests_enabled, daily_use_note, updated_by, updated_at)
  VALUES (p_branch_id, p_medium_fee, p_large_fee, p_gst_enabled, p_gst_rate, p_portal_requests_enabled, NULLIF(trim(p_daily_use_note),''), v_uid, now())
  ON CONFLICT (branch_id) DO UPDATE SET medium_fee = EXCLUDED.medium_fee, large_fee = EXCLUDED.large_fee,
    gst_enabled = EXCLUDED.gst_enabled, gst_rate = EXCLUDED.gst_rate,
    portal_requests_enabled = EXCLUDED.portal_requests_enabled, daily_use_note = EXCLUDED.daily_use_note,
    updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING to_jsonb(s) INTO v_new;

  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, old_data, new_data, action_description)
  VALUES (p_branch_id, v_uid, 'UPDATE', 'locker_pricing_settings', p_branch_id, v_old, v_new, 'Locker pricing updated');
  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.update_locker_pricing_settings(uuid,numeric,numeric,boolean,numeric,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_locker_pricing_settings(uuid,numeric,numeric,boolean,numeric,boolean,text) TO authenticated, service_role;

-- Approve a member locker request: assigns the locker until membership end, raises the invoice
-- at the branch's configured price, and marks the request approved — all in one transaction.
CREATE OR REPLACE FUNCTION public.approve_locker_request(p_request_id uuid, p_locker_id uuid, p_size text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_req record; v_locker record; v_cfg record;
  v_fee numeric; v_rate numeric; v_end date; v_res jsonb;
BEGIN
  SELECT * INTO v_req FROM public.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_req.approval_type <> 'locker_request' THEN RAISE EXCEPTION 'Locker request not found'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been decided'; END IF;
  SELECT * INTO v_locker FROM public.lockers WHERE id = p_locker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Locker not found'; END IF;

  IF public.rpc_guard_applies('approve_locker_request') THEN
    IF NOT (public.has_any_role(v_uid, ARRAY['owner','admin']::text[])
            OR (public.has_any_role(v_uid, ARRAY['manager','staff']::text[])
                AND v_locker.branch_id IN (SELECT public.user_visible_branches(v_uid)))) THEN
      RAISE EXCEPTION 'Not authorized to approve locker requests' USING ERRCODE = '42501';
    END IF;
    IF v_req.requested_by = v_uid AND NOT public.has_any_role(v_uid, ARRAY['owner','admin']::text[]) THEN
      RAISE EXCEPTION 'You cannot approve your own request' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_cfg FROM public.locker_pricing_settings WHERE branch_id = v_locker.branch_id;
  v_fee := CASE WHEN lower(p_size) = 'large' THEN COALESCE(v_cfg.large_fee, 3500) ELSE COALESCE(v_cfg.medium_fee, 2500) END;
  v_rate := CASE WHEN COALESCE(v_cfg.gst_enabled, true) THEN COALESCE(v_cfg.gst_rate, 18) ELSE 0 END;

  SELECT m.end_date INTO v_end FROM public.memberships m
   WHERE m.member_id = v_req.reference_id AND m.status IN ('active','frozen') AND m.end_date >= current_date
   ORDER BY m.end_date DESC LIMIT 1;
  IF v_end IS NULL THEN RAISE EXCEPTION 'Member has no active membership to attach a locker to'; END IF;

  v_res := public.assign_locker_with_billing(p_locker_id, v_req.reference_id, current_date, v_end,
             v_fee, 1, v_fee > 0, v_rate, v_uid, 'addon');

  UPDATE public.approval_requests SET status = 'approved', reviewed_by = v_uid, reviewed_at = now(),
    review_notes = COALESCE(NULLIF(trim(p_notes),''), 'Locker ' || v_locker.locker_number || ' assigned until ' || to_char(v_end,'DD Mon YYYY')),
    request_data = COALESCE(request_data,'{}'::jsonb) || jsonb_build_object('assigned_locker', v_locker.locker_number,
      'charged_fee', v_fee, 'gst_rate', v_rate, 'invoice_id', v_res->>'invoice_id', 'final_size', p_size),
    side_effects_committed_at = now(), updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO public.audit_logs (branch_id, user_id, action, table_name, record_id, new_data, action_description)
  VALUES (v_locker.branch_id, v_uid, 'APPROVE', 'approval_requests', p_request_id,
    v_res || jsonb_build_object('fee', v_fee, 'gst_rate', v_rate, 'size', p_size), 'Locker request approved and invoiced');
  RETURN v_res || jsonb_build_object('fee', v_fee, 'gst_rate', v_rate, 'locker_number', v_locker.locker_number);
END $$;
REVOKE ALL ON FUNCTION public.approve_locker_request(uuid,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_locker_request(uuid,uuid,text,text) TO authenticated, service_role;