CREATE UNIQUE INDEX IF NOT EXISTS access_logs_mips_reconcile_record_uidx
ON public.access_logs ((payload->>'mips_record_id'))
WHERE payload->>'source' = 'mips_record_reconcile'
  AND payload->>'mips_record_id' IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_access_logs_mips_reconcile_created
ON public.access_logs (created_at DESC)
WHERE payload->>'source' = 'mips_record_reconcile';