CREATE OR REPLACE VIEW public.v_template_with_meta_status AS
 SELECT t.id, t.branch_id, t.name, t.type, t.subject, t.content, t.trigger_event, t.is_active,
    t.created_at, t.updated_at, t.meta_template_name, t.meta_template_status, t.meta_rejection_reason,
    t.header_type, t.header_media_url, t.attachment_source, t.attachment_filename_template, t.variables,
        CASE
            WHEN (t.type <> 'whatsapp'::text) THEN 'not_applicable'::text
            WHEN (wt.status = 'APPROVED'::text) THEN 'approved'::text
            WHEN (wt.status = 'PENDING'::text) THEN 'pending'::text
            WHEN (wt.status = 'REJECTED'::text) THEN 'rejected'::text
            WHEN (wt.status = ANY (ARRAY['PAUSED'::text, 'DISABLED'::text])) THEN 'paused'::text
            WHEN (t.meta_template_name IS NULL) THEN 'draft'::text
            WHEN (upper(COALESCE(t.meta_template_status, ''::text)) = 'APPROVED'::text) THEN 'approved'::text
            WHEN (upper(COALESCE(t.meta_template_status, ''::text)) = 'PENDING'::text) THEN 'pending'::text
            WHEN (upper(COALESCE(t.meta_template_status, ''::text)) = 'REJECTED'::text) THEN 'rejected'::text
            ELSE 'pending'::text
        END AS approval_status,
    wt.id AS whatsapp_template_id, wt.status AS whatsapp_meta_status, wt.rejected_reason AS whatsapp_rejected_reason,
    wt.language AS whatsapp_language, wt.category AS whatsapp_category, wt.quality_score AS whatsapp_quality_score,
    COALESCE(wt.is_stale, false) AS is_stale, wt.synced_at AS meta_synced_at,
        CASE
            WHEN (t.type <> 'whatsapp'::text) THEN NULL::text
            WHEN (wt.status IS NULL) THEN NULL::text
            WHEN (wt.status <> 'APPROVED'::text) THEN 'not_approved'::text
            WHEN COALESCE(wt.is_stale, false) THEN 'stale'::text
            WHEN ((wt.category = 'MARKETING'::text) AND ((t.trigger_event = ANY (ARRAY['lead_created'::text, 'payment_received'::text, 'payment_due'::text, 'invoice_generated'::text, 'receipt_generated'::text, 'pos_order_completed'::text, 'membership_expiring_7d'::text, 'membership_expiring_1d'::text, 'membership_expired'::text, 'membership_overdue'::text, 'freeze_confirmed'::text, 'unfreeze_confirmed'::text, 'otp_verification'::text, 'contract_signed_confirmation'::text, 'class_booked'::text, 'class_reminder_24h'::text, 'facility_booked'::text, 'facility_cancelled'::text, 'pt_session_booked'::text, 'pt_session_reminder'::text, 'pt_session_logged'::text, 'benefit_consumed'::text, 'benefit_low_balance'::text, 'body_scan_ready'::text, 'diet_plan_ready'::text, 'workout_plan_ready'::text, 'staff_attendance_recorded'::text])) OR (t.meta_template_name ~~* 'internal_%'::text) OR (t.meta_template_name ~~* '%_alert%'::text) OR (t.meta_template_name ~~* '%otp%'::text) OR (t.meta_template_name ~~* '%receipt%'::text) OR (t.meta_template_name ~~* '%invoice%'::text))) THEN 'category_drift_to_marketing'::text
            ELSE 'ok'::text
        END AS send_risk,
    t.dlt_template_id, t.dlt_header, t.dlt_category,
    t.msg91_template_id, t.msg91_version_id, t.msg91_sync_status, t.msg91_sync_error, t.msg91_synced_at
   FROM (templates t
     LEFT JOIN whatsapp_templates wt ON (((lower(wt.name) = lower(COALESCE(t.meta_template_name, ''::text))) AND ((wt.branch_id = t.branch_id) OR (t.branch_id IS NULL)))));