CREATE TABLE IF NOT EXISTS public.staff_shift_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  branch_id uuid,
  date date NOT NULL,
  morning_start time,
  morning_end time,
  evening_start time,
  evening_end time,
  is_weekly_off boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_staff_shift_overrides_branch_date
  ON public.staff_shift_overrides(branch_id, date);
CREATE INDEX IF NOT EXISTS idx_staff_shift_overrides_user_date
  ON public.staff_shift_overrides(user_id, date);

ALTER TABLE public.staff_shift_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='staff_shift_overrides' AND policyname='staff_shift_overrides_admin_all') THEN
    CREATE POLICY staff_shift_overrides_admin_all ON public.staff_shift_overrides FOR ALL TO authenticated
      USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'))
      WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'manager'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='staff_shift_overrides' AND policyname='staff_shift_overrides_self_read') THEN
    CREATE POLICY staff_shift_overrides_self_read ON public.staff_shift_overrides FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tg_staff_shift_overrides_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_staff_shift_overrides_touch ON public.staff_shift_overrides;
CREATE TRIGGER tg_staff_shift_overrides_touch
  BEFORE UPDATE ON public.staff_shift_overrides
  FOR EACH ROW EXECUTE FUNCTION public.tg_staff_shift_overrides_touch();