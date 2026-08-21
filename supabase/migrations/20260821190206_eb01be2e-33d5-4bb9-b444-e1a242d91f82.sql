-- Add mips_sync_secret to branch_settings if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'branch_settings' AND column_name = 'mips_sync_secret') THEN
        ALTER TABLE public.branch_settings ADD COLUMN mips_sync_secret text;
    END IF;
END $$;

-- Update the sync trigger function to use the secret header
CREATE OR REPLACE FUNCTION public.tg_sync_hardware_access_to_mips()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch_id uuid;
  v_secret text;
BEGIN
  -- Determine branch_id from the triggering table
  IF TG_TABLE_NAME = 'members' THEN
    v_branch_id := NEW.branch_id;
  ELSIF TG_TABLE_NAME = 'invoices' THEN
    v_branch_id := NEW.branch_id;
  END IF;

  -- Get the secret for this branch or global fallback
  SELECT mips_sync_secret INTO v_secret 
  FROM public.branch_settings 
  WHERE (branch_id = v_branch_id OR branch_id IS NULL)
  ORDER BY branch_id NULLS LAST
  LIMIT 1;

  -- Call the edge function with the secret header
  PERFORM
    net.http_post(
      url := 'https://iyqqpbvnszyrrgerniog.supabase.co/functions/v1/mips-access',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-hardware-sync-secret', COALESCE(v_secret, '')
      ),
      body := jsonb_build_object(
        'action', 'sweep_expired'
      ),
      timeout_milliseconds := 5000
    );

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.tg_sync_hardware_access_to_mips() TO service_role;
GRANT ALL ON TABLE public.branch_settings TO service_role;
GRANT SELECT ON TABLE public.branch_settings TO authenticated;
