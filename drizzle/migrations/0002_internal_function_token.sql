CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS private.internal_fn_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32),'hex'),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.internal_fn_config(id) VALUES (true) ON CONFLICT DO NOTHING;
REVOKE ALL ON private.internal_fn_config FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.internal_fn_token()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private
AS $$ SELECT token FROM private.internal_fn_config WHERE id = true $$;
REVOKE EXECUTE ON FUNCTION public.internal_fn_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_fn_token() TO service_role;

CREATE OR REPLACE FUNCTION public.verify_internal_fn_token(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, private
AS $$ SELECT p_token IS NOT NULL AND length(p_token) >= 32 AND p_token = (SELECT token FROM private.internal_fn_config WHERE id = true) $$;
REVOKE EXECUTE ON FUNCTION public.verify_internal_fn_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_internal_fn_token(text) TO service_role;