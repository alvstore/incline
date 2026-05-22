UPDATE lead_notification_rules
SET team_alert_email_body = replace(team_alert_email_body, E'\\n', E'\n')
WHERE team_alert_email_body LIKE '%\\n%';

UPDATE lead_notification_rules
SET lead_welcome_email_body = replace(lead_welcome_email_body, E'\\n', E'\n')
WHERE lead_welcome_email_body LIKE '%\\n%';