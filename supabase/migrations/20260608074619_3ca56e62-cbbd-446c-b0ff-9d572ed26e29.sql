DELETE FROM public.automation_rules WHERE key IN ('monitor_ai_lead_loss','sync_ai_knowledge') AND branch_id IS NULL;
INSERT INTO public.automation_rules (branch_id, key, name, description, category, worker, cron_expression, is_active, is_system)
VALUES
  (NULL, 'monitor_ai_lead_loss',
   'AI Reply SLA Monitor',
   'Detects inbound WhatsApp/IG messages with no AI reply within 5 minutes; logs to error_logs and re-invokes the brain once to recover.',
   'system', 'edge:monitor-ai-lead-loss', '*/5 * * * *', true, true),
  (NULL, 'sync_ai_knowledge',
   'AI Knowledge Catalog Sync',
   'Syncs active membership plans, PT packages, branches, and facilities into ai_knowledge so RAG retrieval has up-to-date ground truth.',
   'system', 'edge:sync-ai-knowledge', '0 * * * *', true, true);