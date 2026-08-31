CREATE OR REPLACE FUNCTION public.tg_profiles_guard_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(),'owner')
     OR public.has_role(auth.uid(),'admin')
     OR public.has_role(auth.uid(),'manager')
     OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.government_id_verified := OLD.government_id_verified;
  NEW.is_active := OLD.is_active;

  -- Allow only the vetted complete_password_setup() path to clear this flag
  -- for the user's own profile.
  IF NOT (coalesce(current_setting('app.password_setup', true), '') = 'true'
          AND NEW.id = auth.uid()
          AND NEW.must_set_password IS FALSE) THEN
    NEW.must_set_password := OLD.must_set_password;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_password_setup()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  PERFORM set_config('app.password_setup', 'true', true);

  UPDATE public.profiles
     SET must_set_password = false,
         updated_at = now()
   WHERE id = auth.uid();

  ok := FOUND;

  PERFORM set_config('app.password_setup', 'false', true);

  RETURN ok;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_password_setup() FROM public;
GRANT EXECUTE ON FUNCTION public.complete_password_setup() TO authenticated;