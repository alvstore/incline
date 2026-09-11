DO $$
DECLARE
  v_body_log uuid := 'f9bcb33b-2eaf-4d17-b868-77e772928491';
  v_posture_log uuid := '63f824f0-f8fe-4b94-aeb3-aacf45b51fae';
  v_member uuid := '53726c3d-dc90-4ec2-8cd0-266f2bdf2ec7';
  v_branch uuid := '11111111-1111-1111-1111-111111111111';
  v_body_provider text := 'wamid.HBgMOTE5Njk0NDkyODMwFQIAERgSOEJCNDY0NzNFMUFFQzRDRTYyAA==';
  v_posture_provider text := 'wamid.HBgMOTE5Njk0NDkyODMwFQIAERgSNDY0MkU2REZFRTE4NDM5NkQzAA==';
  v_error text := '131047: Outside 24-hour customer-service window; an approved WhatsApp template is required.';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.communication_logs WHERE id = v_body_log)
     OR NOT EXISTS (SELECT 1 FROM public.communication_logs WHERE id = v_posture_log) THEN
    RAISE EXCEPTION 'Expected historical scan communication logs are missing';
  END IF;

  UPDATE public.communication_logs
  SET member_id = v_member,
      branch_id = v_branch,
      type = 'whatsapp',
      channel = 'whatsapp',
      category = 'transactional',
      status = 'failed',
      delivery_status = 'failed',
      provider_message_id = v_body_provider,
      error_message = v_error,
      failed_at = COALESCE(failed_at, now()),
      sent_at = NULL,
      delivered_at = NULL,
      read_at = NULL,
      dedupe_key = NULL,
      delivery_metadata = COALESCE(delivery_metadata, '{}'::jsonb) || jsonb_build_object(
        'source_caller', 'deliver-scan-report',
        'source_type', 'system',
        'report_kind', 'body',
        'report_id', '41f9284c-cf7d-44e4-89c6-22c0e870e8a6',
        'historical_reconciliation', true
      )
  WHERE id = v_body_log;

  UPDATE public.communication_logs
  SET member_id = v_member,
      branch_id = v_branch,
      type = 'whatsapp',
      channel = 'whatsapp',
      category = 'transactional',
      status = 'failed',
      delivery_status = 'failed',
      provider_message_id = v_posture_provider,
      error_message = v_error,
      failed_at = COALESCE(failed_at, now()),
      sent_at = NULL,
      delivered_at = NULL,
      read_at = NULL,
      dedupe_key = NULL,
      delivery_metadata = COALESCE(delivery_metadata, '{}'::jsonb) || jsonb_build_object(
        'source_caller', 'deliver-scan-report',
        'source_type', 'system',
        'report_kind', 'posture',
        'report_id', 'a99f828b-55dc-4070-b0d3-1146adf53e5c',
        'historical_reconciliation', true
      )
  WHERE id = v_posture_log;

  UPDATE public.scan_report_deliveries
  SET whatsapp_communication_log_id = CASE kind
        WHEN 'body' THEN v_body_log
        WHEN 'posture' THEN v_posture_log
      END,
      whatsapp_status = 'failed',
      whatsapp_error = v_error,
      whatsapp_provider_message_id = CASE kind
        WHEN 'body' THEN v_body_provider
        WHEN 'posture' THEN v_posture_provider
      END,
      whatsapp_accepted_at = NULL,
      whatsapp_delivered_at = NULL,
      whatsapp_read_at = NULL,
      updated_at = now()
  WHERE member_id = v_member
    AND ((kind = 'body' AND report_id = '41f9284c-cf7d-44e4-89c6-22c0e870e8a6')
      OR (kind = 'posture' AND report_id = 'a99f828b-55dc-4070-b0d3-1146adf53e5c'));

  UPDATE public.whatsapp_messages
  SET communication_log_id = CASE id
        WHEN '8ce80815-c585-4369-9607-c953ee846de8'::uuid THEN v_body_log
        WHEN '9aee3ea3-2f1f-4265-92ea-d8cf2664b5ea'::uuid THEN v_posture_log
      END
  WHERE id IN (
    '8ce80815-c585-4369-9607-c953ee846de8'::uuid,
    '9aee3ea3-2f1f-4265-92ea-d8cf2664b5ea'::uuid
  );

  INSERT INTO public.communication_delivery_events (
    branch_id, communication_log_id, member_id, channel,
    previous_status, new_status, provider, provider_message_id,
    error_message, metadata
  )
  VALUES
    (v_branch, v_body_log, v_member, 'whatsapp', 'sent', 'failed', 'meta', v_body_provider,
      v_error, jsonb_build_object('source', 'historical_scan_reconciliation', 'report_kind', 'body')),
    (v_branch, v_posture_log, v_member, 'whatsapp', 'sent', 'failed', 'meta', v_posture_provider,
      v_error, jsonb_build_object('source', 'historical_scan_reconciliation', 'report_kind', 'posture'))
  ON CONFLICT (communication_log_id, new_status) WHERE communication_log_id IS NOT NULL DO NOTHING;
END $$;