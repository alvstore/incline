DROP POLICY IF EXISTS "Token-based public access" ON public.howbody_public_report_tokens;
REVOKE SELECT ON public.howbody_public_report_tokens FROM anon;