
ALTER TABLE public.lead_notification_rules
  ADD COLUMN IF NOT EXISTS email_to_lead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_to_admins boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_to_managers boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lead_welcome_email_subject text NOT NULL DEFAULT 'Welcome to {{branch_name}}',
  ADD COLUMN IF NOT EXISTS lead_welcome_email_body text NOT NULL DEFAULT 'Hi {{lead_name}},\n\nThank you for your interest in {{branch_name}}. Our team will reach out shortly.\n\n— Team {{branch_name}}',
  ADD COLUMN IF NOT EXISTS team_alert_email_subject text NOT NULL DEFAULT 'New Lead: {{lead_name}}',
  ADD COLUMN IF NOT EXISTS team_alert_email_body text NOT NULL DEFAULT 'A new lead was captured.\n\nName: {{lead_name}}\nPhone: {{lead_phone}}\nEmail: {{lead_email}}\nSource: {{lead_source}}\nBranch: {{branch_name}}\n\nPlease follow up at the earliest.';

ALTER TABLE public.lead_notification_admin_prefs
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT true;
