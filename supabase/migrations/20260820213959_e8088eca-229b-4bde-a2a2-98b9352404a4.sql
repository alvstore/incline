-- Corrected optimization for DR table counts
CREATE OR REPLACE FUNCTION public.dr_table_counts()
RETURNS TABLE(table_name text, row_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.relname::text,
    c.reltuples::bigint
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r' 
    AND n.nspname = 'public'
    AND c.relname NOT IN (
      'dr_config', 
      'communication_logs', 
      'audit_logs', 
      'error_logs',
      'whatsapp_message_logs'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dr_table_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.dr_table_counts() TO authenticated;