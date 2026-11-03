CREATE OR REPLACE VIEW public.v_template_with_meta_status AS
SELECT t.id, t.branch_id, t.name, t.type, t.subject, t.content, t.trigger_event, t.is_active, t.created_at, t.updated_at,
    t.meta_template_name, t.meta_template_status, t.meta_rejection_reason, t.header_type, t.header_media_url,
    t.attachment_source, t.attachment_filename_template, t.variables,
    CASE
        WHEN t.type <> 'whatsapp' THEN 'not_applicable'
        WHEN wt.status = 'APPROVED' THEN 'approved'
        WHEN wt.status = 'PENDING' THEN 'pending'
        WHEN wt.status = 'REJECTED' THEN 'rejected'
        WHEN wt.status = ANY (ARRAY['PAUSED','DISABLED']) THEN 'paused'
        WHEN t.meta_template_name IS NULL THEN 'draft'
        WHEN upper(COALESCE(t.meta_template_status,'')) = 'APPROVED' THEN 'approved'
        WHEN upper(COALESCE(t.meta_template_status,'')) = 'PENDING' THEN 'pending'
        WHEN upper(COALESCE(t.meta_template_status,'')) = 'REJECTED' THEN 'rejected'
        ELSE 'pending'
    END AS approval_status,
    wt.id AS whatsapp_template_id, wt.status AS whatsapp_meta_status, wt.rejected_reason AS whatsapp_rejected_reason,
    wt.language AS whatsapp_language, wt.category AS whatsapp_category, wt.quality_score AS whatsapp_quality_score,
    COALESCE(wt.is_stale,false) AS is_stale, wt.synced_at AS meta_synced_at,
    CASE
        WHEN t.type <> 'whatsapp' THEN NULL
        WHEN wt.status IS NULL THEN NULL
        WHEN wt.status <> 'APPROVED' THEN 'not_approved'
        WHEN COALESCE(wt.is_stale,false) THEN 'stale'
        WHEN wt.category = 'MARKETING' AND (t.trigger_event = ANY (ARRAY['lead_created','payment_received','payment_due','invoice_generated','receipt_generated','pos_order_completed','membership_expiring_7d','membership_expiring_1d','membership_expired','membership_overdue','freeze_confirmed','unfreeze_confirmed','otp_verification','contract_signed_confirmation','class_booked','class_reminder_24h','facility_booked','facility_cancelled','pt_session_booked','pt_session_reminder','pt_session_logged','benefit_consumed','benefit_low_balance','body_scan_ready','diet_plan_ready','workout_plan_ready','staff_attendance_recorded']) OR t.meta_template_name ILIKE 'internal_%' OR t.meta_template_name ILIKE '%_alert%' OR t.meta_template_name ILIKE '%otp%' OR t.meta_template_name ILIKE '%receipt%' OR t.meta_template_name ILIKE '%invoice%') THEN 'category_drift_to_marketing'
        ELSE 'ok'
    END AS send_risk,
    t.dlt_template_id, t.dlt_header, t.dlt_category
FROM public.templates t
LEFT JOIN public.whatsapp_templates wt ON lower(wt.name) = lower(COALESCE(t.meta_template_name,'')) AND (wt.branch_id = t.branch_id OR t.branch_id IS NULL);