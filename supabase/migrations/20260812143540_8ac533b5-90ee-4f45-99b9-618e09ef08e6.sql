-- Update MIPS connection password for the main branch
UPDATE public.mips_connections 
SET password = 'Incline@3003', updated_at = now()
WHERE branch_id = '11111111-1111-1111-1111-111111111111' 
  AND username = 'admin';

-- Trigger a re-sync for Bhavik Jain by clearing the mips_sync_status
UPDATE public.members 
SET mips_sync_status = 'pending', updated_at = now()
WHERE id = '76a06fb1-438b-4288-8d6a-4f9cd4f8abda';