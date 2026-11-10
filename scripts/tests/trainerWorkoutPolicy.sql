-- Run with the managed PostgreSQL connection. All fixture rows are rolled back.
BEGIN;
CREATE TEMP TABLE workout_policy_fixture AS
SELECT m.id AS member_id, m.user_id AS member_user, t.user_id AS trainer_user,
  (SELECT x.user_id FROM public.trainers x WHERE x.is_active AND x.user_id <> t.user_id
    AND NOT public._trainer_owns_member(x.user_id, m.id) LIMIT 1) AS unrelated_user
FROM public.members m JOIN public.trainers t ON t.id=m.assigned_trainer_id
WHERE m.user_id IS NOT NULL AND t.is_active LIMIT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM workout_policy_fixture WHERE unrelated_user IS NOT NULL)
    THEN RAISE EXCEPTION 'No valid live policy fixtures'; END IF;
END $$;
GRANT SELECT ON workout_policy_fixture TO authenticated;
INSERT INTO public.treadmill_workouts
  (id,member_id,treadmill_code,mac_address,duration_seconds,distance_meters,calories_burned,avg_speed_kmh)
SELECT 'policy-regression-rollback',member_id,'POLICY-TEST','policy-test',60,100,5,6 FROM workout_policy_fixture;
SELECT set_config('request.jwt.claim.sub',member_user::text,true),
  set_config('request.jwt.claims',json_build_object('sub',member_user,'role','authenticated')::text,true),
  set_config('request.path','/treadmill_workouts',true) FROM workout_policy_fixture;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.treadmill_workouts WHERE id='policy-regression-rollback') <> 1
    THEN RAISE EXCEPTION 'Member must read own workout'; END IF;
  IF public.trainer_can_read_member_runs((SELECT member_id FROM workout_policy_fixture))
    THEN RAISE EXCEPTION 'Member must not gain trainer privileges'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',trainer_user::text,true),
  set_config('request.jwt.claims',json_build_object('sub',trainer_user,'role','authenticated')::text,true)
FROM workout_policy_fixture;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT public.trainer_can_read_member_runs((SELECT member_id FROM workout_policy_fixture))
    THEN RAISE EXCEPTION 'Assigned trainer must pass caller-bound check'; END IF;
  IF (SELECT count(*) FROM public.treadmill_workouts WHERE id='policy-regression-rollback') <> 1
    THEN RAISE EXCEPTION 'Assigned trainer must read workout'; END IF;
  IF public.trainer_can_read_member_runs('00000000-0000-0000-0000-000000000000')
    THEN RAISE EXCEPTION 'Unknown member must fail closed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub',unrelated_user::text,true),
  set_config('request.jwt.claims',json_build_object('sub',unrelated_user,'role','authenticated')::text,true)
FROM workout_policy_fixture;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.treadmill_workouts WHERE id='policy-regression-rollback') <> 0
    THEN RAISE EXCEPTION 'Unrelated trainer must not read workout'; END IF;
  IF public.trainer_can_read_member_runs((SELECT member_id FROM workout_policy_fixture))
    THEN RAISE EXCEPTION 'Unrelated trainer must fail ownership check'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('authenticated','public._trainer_owns_member(uuid,uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'Internal helper must remain private'; END IF;
  IF has_function_privilege('anon','public.trainer_can_read_member_runs(uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'Anonymous helper execution must remain blocked'; END IF;
END $$;
ROLLBACK;