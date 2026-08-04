CREATE TABLE IF NOT EXISTS public.mips_device_face_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  device_id uuid REFERENCES public.access_devices(id) ON DELETE CASCADE,
  mips_device_id integer NOT NULL,
  device_name text,
  person_sn text NOT NULL,
  person_type text NOT NULL CHECK (person_type IN ('member','employee','trainer')),
  person_id uuid,
  person_name text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','enrolled','rejected','missing')),
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  enrolled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mips_device_id, person_sn)
);

CREATE INDEX IF NOT EXISTS idx_mips_face_state_branch_state
  ON public.mips_device_face_state (branch_id, state);
CREATE INDEX IF NOT EXISTS idx_mips_face_state_person
  ON public.mips_device_face_state (person_type, person_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mips_device_face_state TO authenticated;
GRANT ALL ON public.mips_device_face_state TO service_role;

ALTER TABLE public.mips_device_face_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Branch staff read face state"
  ON public.mips_device_face_state FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role,'staff'::app_role,'trainer'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

CREATE POLICY "Branch admins manage face state"
  ON public.mips_device_face_state FOR ALL TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role,'manager'::app_role])
    AND branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
  );

CREATE TRIGGER trg_mips_face_state_updated_at
  BEFORE UPDATE ON public.mips_device_face_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Security fix 1: branch-scope the manager clause on biometric_sync_queue
DROP POLICY IF EXISTS "Owners admins managers manage sync queue" ON public.biometric_sync_queue;

CREATE POLICY "Owners admins manage sync queue"
  ON public.biometric_sync_queue FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role]));

CREATE POLICY "Managers manage sync queue in their branches"
  ON public.biometric_sync_queue FOR ALL TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND (
      device_id IN (SELECT ad.id FROM public.access_devices ad WHERE ad.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR member_id IN (SELECT m.id FROM public.members m WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR staff_id IN (SELECT e.id FROM public.employees e WHERE e.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
    )
  )
  WITH CHECK (
    has_any_role(auth.uid(), ARRAY['manager'::app_role])
    AND (
      device_id IN (SELECT ad.id FROM public.access_devices ad WHERE ad.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR member_id IN (SELECT m.id FROM public.members m WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
      OR staff_id IN (SELECT e.id FROM public.employees e WHERE e.branch_id IN (SELECT user_visible_branch_ids(auth.uid())))
    )
  );

-- Security fix 2: branch-scope staff reads on howbody_scan_sessions
DROP POLICY IF EXISTS "Staff reads sessions" ON public.howbody_scan_sessions;

CREATE POLICY "Staff reads sessions in their branches"
  ON public.howbody_scan_sessions FOR SELECT TO authenticated
  USING (
    has_any_role(auth.uid(), ARRAY['owner'::app_role,'admin'::app_role])
    OR (
      has_any_role(auth.uid(), ARRAY['manager'::app_role,'staff'::app_role,'trainer'::app_role])
      AND (
        member_id IS NULL
        OR member_id IN (
          SELECT m.id FROM public.members m
          WHERE m.branch_id IN (SELECT user_visible_branch_ids(auth.uid()))
        )
      )
    )
  );