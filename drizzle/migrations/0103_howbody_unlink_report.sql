CREATE OR REPLACE FUNCTION public.howbody_unlink_report(_kind text, _report_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_member uuid;
BEGIN
  IF rpc_guard_applies('howbody_unlink_report') AND NOT (SELECT has_any_role(auth.uid(), ARRAY['owner','admin','manager']::app_role[])) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE='42501';
  END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'reason required'; END IF;
  IF _kind='body' THEN
    UPDATE howbody_body_reports SET member_id=NULL WHERE id=_report_id RETURNING (SELECT member_id FROM howbody_body_reports WHERE id=_report_id) INTO old_member;
  ELSIF _kind='posture' THEN
    UPDATE howbody_posture_reports SET member_id=NULL WHERE id=_report_id RETURNING (SELECT member_id FROM howbody_posture_reports WHERE id=_report_id) INTO old_member;
  ELSE RAISE EXCEPTION 'invalid kind'; END IF;
  DELETE FROM scan_report_deliveries WHERE report_id=_report_id AND kind=_kind;
  DELETE FROM scan_report_ai_analysis WHERE report_id=_report_id AND kind=_kind;
  INSERT INTO audit_logs(action, table_name, record_id, new_data)
  VALUES('HOWBODY_SCAN_UNLINKED','howbody_'||_kind||'_reports',_report_id,jsonb_build_object('previous_member_id',old_member,'reason',_reason));
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.howbody_unlink_report(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.howbody_unlink_report(text, uuid, text) TO authenticated, service_role;