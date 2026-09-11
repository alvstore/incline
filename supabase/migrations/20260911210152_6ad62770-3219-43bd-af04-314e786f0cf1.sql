ALTER TABLE public.scan_report_deliveries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.scan_report_deliveries
SET original_pdf_path = 'scans/53726c3d-dc90-4ec2-8cd0-266f2bdf2ec7/original/body-41f9284c-cf7d-44e4-89c6-22c0e870e8a6.pdf',
    pdf_source = 'howbody_original',
    whatsapp_status = 'failed',
    whatsapp_error = '131047: Outside 24-hour customer-service window; an approved WhatsApp template is required.',
    whatsapp_provider_message_id = 'wamid.HBgMOTE5Njk0NDkyODMwFQIAERgSOEJCNDY0NzNFMUFFQzRDRTYyAA==',
    whatsapp_accepted_at = '2026-09-11 15:18:35+00',
    updated_at = now()
WHERE report_id = '41f9284c-cf7d-44e4-89c6-22c0e870e8a6' AND kind = 'body';

UPDATE public.scan_report_deliveries
SET original_pdf_path = 'scans/53726c3d-dc90-4ec2-8cd0-266f2bdf2ec7/original/posture-a99f828b-55dc-4070-b0d3-1146adf53e5c.pdf',
    pdf_source = 'howbody_original',
    whatsapp_status = 'failed',
    whatsapp_error = '131047: Outside 24-hour customer-service window; an approved WhatsApp template is required.',
    whatsapp_provider_message_id = 'wamid.HBgMOTE5Njk0NDkyODMwFQIAERgSNDY0MkU2REZFRTE4NDM5NkQzAA==',
    whatsapp_accepted_at = '2026-09-11 15:18:50+00',
    updated_at = now()
WHERE report_id = 'a99f828b-55dc-4070-b0d3-1146adf53e5c' AND kind = 'posture';