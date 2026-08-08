-- Diet plans and scan reports had no document-header WhatsApp template, so the
-- dispatcher fell back to a body-only template and pasted the storage link.
INSERT INTO public.templates
  (branch_id, name, type, content, trigger_event, header_type, header_media_url,
   attachment_source, attachment_filename_template, meta_template_status, is_active, variables)
VALUES
  (NULL,
   'diet_plan_document_v1',
   'whatsapp',
   'Hi {{member_name}}, your personalised diet plan {{plan_name}} from {{branch_name}} is attached as a PDF. Open it any time from your member portal. — Team Incline',
   'diet_plan_ready',
   'document',
   'https://iyqqpbvnszyrrgerniog.supabase.co/storage/v1/object/public/template-media/samples/incline-sample-document.pdf',
   'dynamic',
   'Diet-Plan-{{plan_name}}.pdf',
   'DRAFT',
   true,
   '["member_name","plan_name","branch_name"]'::jsonb),
  (NULL,
   'scan_report_document_v1',
   'whatsapp',
   'Hi {{member_name}}, your body composition scan report from {{branch_name}} is attached as a PDF. Please discuss the results with your trainer. — Team Incline',
   'scan_report_ready',
   'document',
   'https://iyqqpbvnszyrrgerniog.supabase.co/storage/v1/object/public/template-media/samples/incline-sample-document.pdf',
   'dynamic',
   'Scan-Report-{{member_name}}.pdf',
   'DRAFT',
   true,
   '["member_name","branch_name"]'::jsonb);

-- Retire the inactive link-style drafts that keep re-surfacing in the picker.
UPDATE public.templates
   SET is_active = false
 WHERE type = 'whatsapp'
   AND name IN ('diet_plan_ready_link', 'workout_plan_ready_link', 'scan_report_link', 'payment_receipt_link')
   AND meta_template_name IS NULL;