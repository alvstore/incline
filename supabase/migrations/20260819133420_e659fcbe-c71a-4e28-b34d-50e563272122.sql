-- Fix the trigger function to use the correct pg_net argument names
CREATE OR REPLACE FUNCTION public.tg_sync_hardware_access_to_mips()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_action text;
BEGIN
  -- We only push if the record says it requires sync
  IF NOT NEW.requires_sync THEN
    RETURN NEW;
  END IF;

  -- Resolve credentials (same pattern as tg_push_photo_to_mips)
  v_supabase_url := 'https://iyqqpbvnszyrrgerniog.supabase.co';
  v_anon_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cXFwYnZuc3p5cnJnZXJuaW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYyMzE1NjIsImV4cCI6MjA4MTgwNzU2Mn0.EAmMC21oRiyV8sgixS8eQE3-b17_-Y9kn2-os8fv0Eo';

  v_action := CASE
    WHEN NEW.new_status IN ('blocked_overdue', 'blocked_member_status', 'frozen', 'expired', 'revoked') THEN 'revoke'
    WHEN NEW.new_status = 'active' THEN 'restore'
    ELSE NULL
  END;

  IF v_action IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := v_supabase_url || '/functions/v1/mips-access',
        body := jsonb_build_object(
          'action', v_action,
          'member_id', NEW.member_id,
          'branch_id', NEW.branch_id,
          'reason', NEW.reason
        ),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', v_anon_key,
          'Authorization', 'Bearer ' || v_anon_key,
          'x-lovable-system', 'access-event-sync'
        ),
        timeout_milliseconds := 5000
      );

      -- Mark as sync attempted (non-blocking if it fails, the cron sweep will catch it later)
      -- We do this in a separate thread/tx or just trust the next sweep
      -- But since we are in a trigger, we can't easily update the same table's row without recursion risk or overhead.
      -- Better to just leave it as is if it's fire-and-forget.
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'MIPS access sync HTTP call failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;
