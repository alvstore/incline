
CREATE OR REPLACE FUNCTION public.dr_dump_schema()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $func$
DECLARE
  out_text text := '';
  rec record;
BEGIN
  out_text := out_text || format('-- DR schema dump generated %s%s', now(), E'\n');
  out_text := out_text || E'-- Apply with: psql "<STANDBY_CONN>" -v ON_ERROR_STOP=1 -f <this-file>\n\n';

  -- Extensions
  out_text := out_text || E'-- =========== EXTENSIONS ===========\n';
  FOR rec IN
    SELECT extname FROM pg_extension
    WHERE extname NOT IN ('plpgsql','pg_net','pg_cron','supabase_vault')
    ORDER BY extname
  LOOP
    out_text := out_text || format('CREATE EXTENSION IF NOT EXISTS %I;%s', rec.extname, E'\n');
  END LOOP;
  out_text := out_text || E'\n';

  -- Enums
  out_text := out_text || E'-- =========== ENUMS ===========\n';
  FOR rec IN
    SELECT n.nspname, t.typname,
           string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY n.nspname, t.typname
    ORDER BY t.typname
  LOOP
    out_text := out_text || format(
      $ddl$DO $do$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = %L) THEN CREATE TYPE %I.%I AS ENUM (%s); END IF; END $do$;%s$ddl$,
      rec.typname, rec.nspname, rec.typname, rec.labels, E'\n'
    );
  END LOOP;
  out_text := out_text || E'\n';

  -- Sequences
  out_text := out_text || E'-- =========== SEQUENCES ===========\n';
  FOR rec IN
    SELECT sequence_schema, sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
    ORDER BY sequence_name
  LOOP
    out_text := out_text || format('CREATE SEQUENCE IF NOT EXISTS %I.%I;%s',
      rec.sequence_schema, rec.sequence_name, E'\n');
  END LOOP;
  out_text := out_text || E'\n';

  -- Tables (columns only)
  out_text := out_text || E'-- =========== TABLES ===========\n';
  FOR rec IN
    SELECT c.relname AS tname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    out_text := out_text || format('CREATE TABLE IF NOT EXISTS public.%I (', rec.tname);
    out_text := out_text || (
      SELECT E'\n  ' || string_agg(
        format('%I %s%s%s',
          a.attname,
          pg_catalog.format_type(a.atttypid, a.atttypmod),
          CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
          CASE WHEN ad.adbin IS NOT NULL
            THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid)
            ELSE '' END
        ),
        E',\n  '
        ORDER BY a.attnum
      )
      FROM pg_attribute a
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE a.attrelid = format('public.%I', rec.tname)::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
    );
    out_text := out_text || E'\n);\n';
  END LOOP;
  out_text := out_text || E'\n';

  -- Constraints (PK, UNIQUE, CHECK, FK)
  out_text := out_text || E'-- =========== CONSTRAINTS ===========\n';
  FOR rec IN
    SELECT n.nspname, c.relname AS tname, con.conname,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    ORDER BY con.contype, c.relname, con.conname
  LOOP
    out_text := out_text || format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I %s;%s',
      rec.nspname, rec.tname, rec.conname, rec.def, E'\n'
    );
  END LOOP;
  out_text := out_text || E'\n';

  -- Indexes (skip those backing PK/unique)
  out_text := out_text || E'-- =========== INDEXES ===========\n';
  FOR rec IN
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p','u'))
    ORDER BY tablename, indexname
  LOOP
    out_text := out_text || rec.indexdef || E';\n';
  END LOOP;
  out_text := out_text || E'\n';

  -- Views
  out_text := out_text || E'-- =========== VIEWS ===========\n';
  FOR rec IN
    SELECT viewname, definition
    FROM pg_views
    WHERE schemaname = 'public'
    ORDER BY viewname
  LOOP
    out_text := out_text || format('CREATE OR REPLACE VIEW public.%I AS %s%s',
      rec.viewname, rec.definition, E'\n');
  END LOOP;
  out_text := out_text || E'\n';

  -- Functions
  out_text := out_text || E'-- =========== FUNCTIONS ===========\n';
  FOR rec IN
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
    ORDER BY p.proname
  LOOP
    out_text := out_text || rec.def || E';\n\n';
  END LOOP;

  -- Triggers
  out_text := out_text || E'-- =========== TRIGGERS ===========\n';
  FOR rec IN
    SELECT pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  LOOP
    out_text := out_text || rec.def || E';\n';
  END LOOP;
  out_text := out_text || E'\n';

  -- RLS enable
  out_text := out_text || E'-- =========== RLS ===========\n';
  FOR rec IN
    SELECT n.nspname, c.relname AS tname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    out_text := out_text || format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;%s',
      rec.nspname, rec.tname, E'\n');
  END LOOP;

  -- Policies
  FOR rec IN
    SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check, permissive
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  LOOP
    out_text := out_text || format(
      'DROP POLICY IF EXISTS %I ON %I.%I;%sCREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s;%s',
      rec.policyname, rec.schemaname, rec.tablename, E'\n',
      rec.policyname, rec.schemaname, rec.tablename,
      rec.permissive, rec.cmd,
      array_to_string(rec.roles, ', '),
      CASE WHEN rec.qual IS NOT NULL THEN ' USING (' || rec.qual || ')' ELSE '' END,
      CASE WHEN rec.with_check IS NOT NULL THEN ' WITH CHECK (' || rec.with_check || ')' ELSE '' END,
      E'\n'
    );
  END LOOP;
  out_text := out_text || E'\n';

  -- Grants
  out_text := out_text || E'-- =========== GRANTS ===========\n';
  FOR rec IN
    SELECT grantee, table_schema, table_name,
           string_agg(privilege_type, ', ') AS privs
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon','authenticated','service_role')
    GROUP BY grantee, table_schema, table_name
    ORDER BY table_name, grantee
  LOOP
    out_text := out_text || format('GRANT %s ON %I.%I TO %I;%s',
      rec.privs, rec.table_schema, rec.table_name, rec.grantee, E'\n');
  END LOOP;

  RETURN out_text;
END;
$func$;

REVOKE ALL ON FUNCTION public.dr_dump_schema() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dr_dump_schema() TO service_role;


CREATE OR REPLACE FUNCTION public.dr_table_counts()
RETURNS TABLE(table_name text, row_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $func$
DECLARE
  r record;
  c bigint;
BEGIN
  FOR r IN SELECT t.table_name AS tname FROM public.dr_get_replication_tables() t
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.tname) INTO c;
    table_name := r.tname;
    row_count := c;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$func$;

REVOKE ALL ON FUNCTION public.dr_table_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dr_table_counts() TO service_role;
