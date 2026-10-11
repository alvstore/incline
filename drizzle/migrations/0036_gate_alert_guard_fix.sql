
CREATE OR REPLACE FUNCTION public.update_gate_alert(_alert_id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_branch uuid; v_member uuid;
BEGIN
  IF _status NOT IN ('acknowledged','resolved') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT branch_id, member_id INTO v_branch, v_member FROM public.front_desk_alerts WHERE id = _alert_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found'; END IF;
  IF public.rpc_guard_applies('update_gate_alert') THEN
    IF NOT public.is_branch_staff(v_branch, false) THEN
      RAISE EXCEPTION 'forbidden: update_gate_alert' USING ERRCODE = '42501';
    END IF;
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
