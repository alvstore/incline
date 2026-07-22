
-- 1. Realtime for access_logs (Live Access Feed)
ALTER TABLE public.access_logs REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='access_logs') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.access_logs';
  END IF;
END $$;

-- 2. handle_new_user: don't clobber profiles that register-member already upserted
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- If register-member (self-registration) already inserted the profile with
  -- rich data, don't overwrite. Skip entirely for self_register source; for
  -- other flows use ON CONFLICT DO NOTHING so existing rows win.
  IF COALESCE(NEW.raw_user_meta_data ->> 'source', '') = 'self_register' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- 3. source_locked column on members — prevents downstream imports from flipping
--    a self_register member back to walk-in / bulk-import.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS source_locked boolean NOT NULL DEFAULT false;

-- Auto-lock any member whose source is a first-party signup channel.
UPDATE public.members
  SET source_locked = true
  WHERE source IN ('self_register', 'public_registration', 'online')
    AND source_locked = false;

-- Trigger to protect source once locked.
CREATE OR REPLACE FUNCTION public.protect_locked_member_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.source_locked = true AND NEW.source IS DISTINCT FROM OLD.source THEN
    NEW.source := OLD.source;  -- silently ignore attempted overwrite
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_locked_member_source ON public.members;
CREATE TRIGGER trg_protect_locked_member_source
BEFORE UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.protect_locked_member_source();
