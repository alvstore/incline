ALTER TABLE public.mips_sync_attempts ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE public.mips_sync_attempts ALTER COLUMN verification_payload SET DEFAULT '{}'::jsonb;