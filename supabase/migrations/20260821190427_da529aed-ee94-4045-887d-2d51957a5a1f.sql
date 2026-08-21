-- Drop the not-null constraint on branch_id
ALTER TABLE public.branch_settings ALTER COLUMN branch_id DROP NOT NULL;

-- Upsert the global sync secret
INSERT INTO public.branch_settings (branch_id, mips_sync_secret) 
VALUES (NULL, 'HARDCODED_SYNC_SECRET_PLACEHOLDER')
ON CONFLICT (branch_id) WHERE branch_id IS NULL DO UPDATE SET mips_sync_secret = EXCLUDED.mips_sync_secret;
