ALTER TABLE public.member_fitness_plans
  ADD COLUMN IF NOT EXISTS schedule_offset_days smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rotation_interval_days smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rotation_seed smallint NOT NULL DEFAULT 0;

ALTER TABLE public.member_fitness_plans
  DROP CONSTRAINT IF EXISTS member_fitness_plans_schedule_offset_days_check;
ALTER TABLE public.member_fitness_plans
  ADD CONSTRAINT member_fitness_plans_schedule_offset_days_check
  CHECK (schedule_offset_days >= 0 AND schedule_offset_days <= 6);

ALTER TABLE public.member_fitness_plans
  DROP CONSTRAINT IF EXISTS member_fitness_plans_rotation_interval_days_check;
ALTER TABLE public.member_fitness_plans
  ADD CONSTRAINT member_fitness_plans_rotation_interval_days_check
  CHECK (rotation_interval_days >= 0 AND rotation_interval_days <= 90);

COMMENT ON COLUMN public.member_fitness_plans.schedule_offset_days IS
  'Weekday shift (0-6) applied to the plan for this member so identical plans do not put every member on the same machine on the same day.';
COMMENT ON COLUMN public.member_fitness_plans.rotation_interval_days IS
  'When > 0, the member viewer cycles through plan_data.rotation.variants every N days.';

CREATE INDEX IF NOT EXISTS idx_member_fitness_plans_offset_load
  ON public.member_fitness_plans (branch_id, plan_type, schedule_offset_days)
  WHERE plan_type = 'workout';

-- Current gym load per weekday-shift group, so assignment UI can stagger members.
CREATE OR REPLACE FUNCTION public.workout_schedule_offset_load(_branch_id uuid DEFAULT NULL)
RETURNS TABLE (offset_days smallint, active_plans bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.offset_days::smallint,
         COUNT(p.id)::bigint AS active_plans
  FROM generate_series(0, 6) AS g(offset_days)
  LEFT JOIN public.member_fitness_plans p
    ON p.schedule_offset_days = g.offset_days
   AND p.plan_type = 'workout'
   AND (p.valid_until IS NULL OR p.valid_until >= CURRENT_DATE)
   AND (_branch_id IS NULL OR p.branch_id = _branch_id)
  GROUP BY g.offset_days
  ORDER BY g.offset_days;
$$;

REVOKE ALL ON FUNCTION public.workout_schedule_offset_load(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workout_schedule_offset_load(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workout_schedule_offset_load(uuid) TO service_role;