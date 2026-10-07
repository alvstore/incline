CREATE TABLE IF NOT EXISTS private.rcs_webhook_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24),'hex')
);
INSERT INTO private.rcs_webhook_config(id) VALUES (true) ON CONFLICT DO NOTHING;
REVOKE ALL ON private.rcs_webhook_config FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_rcs_webhook_token()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT token FROM private.rcs_webhook_config WHERE id = true);
END $$;
REVOKE EXECUTE ON FUNCTION public.get_rcs_webhook_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_rcs_webhook_token() TO authenticated, service_role;