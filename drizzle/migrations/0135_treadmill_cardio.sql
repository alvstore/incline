CREATE TABLE public.treadmill_live_sessions (
  session_id TEXT PRIMARY KEY,
  treadmill_code TEXT NOT NULL,
  mac_address TEXT NOT NULL,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  branch_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  distance_meters INTEGER NOT NULL DEFAULT 0,
  calories_burned INTEGER NOT NULL DEFAULT 0,
  current_speed_kmh NUMERIC(4,1) NOT NULL DEFAULT 0,
  current_incline_percent NUMERIC(4,1) NOT NULL DEFAULT 0,
  heart_rate_bpm INTEGER DEFAULT 0,
  step_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_treadmill_live_mac ON public.treadmill_live_sessions(mac_address);
CREATE INDEX idx_treadmill_live_member ON public.treadmill_live_sessions(member_id);

CREATE TABLE public.treadmill_workouts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  branch_id UUID,
  treadmill_code TEXT NOT NULL,
  mac_address TEXT NOT NULL,
  session_id TEXT,
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  distance_meters INTEGER NOT NULL CHECK (distance_meters >= 0),
  calories_burned INTEGER NOT NULL CHECK (calories_burned >= 0),
  avg_speed_kmh NUMERIC(4,1) NOT NULL,
  max_speed_kmh NUMERIC(4,1),
  avg_incline_percent NUMERIC(4,1) DEFAULT 0,
  avg_heart_rate INTEGER,
  max_heart_rate INTEGER,
  step_count INTEGER NOT NULL DEFAULT 0,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, session_id)
);
CREATE INDEX idx_treadmill_workouts_member ON public.treadmill_workouts(member_id, created_at DESC);
CREATE INDEX idx_treadmill_workouts_branch ON public.treadmill_workouts(branch_id);

CREATE OR REPLACE FUNCTION public.treadmill_set_branch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT m.branch_id INTO NEW.branch_id FROM public.members m WHERE m.id = NEW.member_id;
  IF TG_TABLE_NAME = 'treadmill_live_sessions' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.treadmill_set_branch() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_treadmill_live_branch BEFORE INSERT OR UPDATE ON public.treadmill_live_sessions FOR EACH ROW EXECUTE FUNCTION public.treadmill_set_branch();
CREATE TRIGGER trg_treadmill_workouts_branch BEFORE INSERT ON public.treadmill_workouts FOR EACH ROW EXECUTE FUNCTION public.treadmill_set_branch();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.treadmill_live_sessions TO authenticated;
GRANT ALL ON public.treadmill_live_sessions TO service_role;
GRANT SELECT, INSERT ON public.treadmill_workouts TO authenticated;
GRANT ALL ON public.treadmill_workouts TO service_role;

ALTER TABLE public.treadmill_live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treadmill_workouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Member manages own live session" ON public.treadmill_live_sessions FOR ALL TO authenticated
  USING (member_id IN (SELECT id FROM public.members WHERE user_id = (SELECT auth.uid())))
  WITH CHECK (member_id IN (SELECT id FROM public.members WHERE user_id = (SELECT auth.uid())));

CREATE POLICY "Member reads own runs" ON public.treadmill_workouts FOR SELECT TO authenticated
  USING (member_id IN (SELECT id FROM public.members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "Member adds own runs" ON public.treadmill_workouts FOR INSERT TO authenticated
  WITH CHECK (member_id IN (SELECT id FROM public.members WHERE user_id = (SELECT auth.uid())));
CREATE POLICY "Trainer reads own clients runs" ON public.treadmill_workouts FOR SELECT TO authenticated
  USING (public._trainer_owns_member((SELECT auth.uid()), member_id));
CREATE POLICY "Owner admin reads all runs" ON public.treadmill_workouts FOR SELECT TO authenticated
  USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['owner','admin']::public.app_role[])));
CREATE POLICY "Manager reads branch runs" ON public.treadmill_workouts FOR SELECT TO authenticated
  USING (branch_id IN (SELECT public.managed_branch_ids((SELECT auth.uid()))));

ALTER PUBLICATION supabase_realtime ADD TABLE public.treadmill_live_sessions;