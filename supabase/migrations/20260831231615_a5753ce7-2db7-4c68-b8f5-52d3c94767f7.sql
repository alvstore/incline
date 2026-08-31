CREATE OR REPLACE FUNCTION public.complete_password_setup()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
     SET must_set_password = false,
         updated_at = now()
   WHERE id = auth.uid();

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_password_setup() FROM public;
GRANT EXECUTE ON FUNCTION public.complete_password_setup() TO authenticated;