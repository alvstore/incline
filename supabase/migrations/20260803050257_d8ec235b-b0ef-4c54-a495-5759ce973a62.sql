CREATE TABLE public.mips_person_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_code text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('member','employee','trainer')),
  target_id uuid NOT NULL,
  person_name text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mips_person_aliases_code_key ON public.mips_person_aliases (upper(person_code));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mips_person_aliases TO authenticated;
GRANT ALL ON public.mips_person_aliases TO service_role;

ALTER TABLE public.mips_person_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view mips person aliases"
  ON public.mips_person_aliases FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'staff')
  );

CREATE POLICY "Managers can manage mips person aliases"
  ON public.mips_person_aliases FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
  );

CREATE TRIGGER update_mips_person_aliases_updated_at
  BEFORE UPDATE ON public.mips_person_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.resolve_mips_person_alias(_person_code text)
RETURNS TABLE (target_type text, target_id uuid, user_id uuid, branch_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.mips_person_aliases%ROWTYPE;
BEGIN
  IF _person_code IS NULL OR btrim(_person_code) = '' THEN
    RETURN;
  END IF;

  SELECT * INTO a FROM public.mips_person_aliases
   WHERE upper(person_code) = upper(btrim(_person_code)) LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF a.target_type = 'member' THEN
    RETURN QUERY SELECT 'member'::text, m.id, m.user_id, m.branch_id
      FROM public.members m WHERE m.id = a.target_id;
  ELSIF a.target_type = 'employee' THEN
    RETURN QUERY SELECT 'employee'::text, e.id, e.user_id, e.branch_id
      FROM public.employees e WHERE e.id = a.target_id;
  ELSE
    RETURN QUERY SELECT 'trainer'::text, t.id, t.user_id, t.branch_id
      FROM public.trainers t WHERE t.id = a.target_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_mips_person_alias(text) TO authenticated, service_role;