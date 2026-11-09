CREATE OR REPLACE FUNCTION public.tg_close_plan_requests_on_assign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text;
BEGIN
  IF NEW.plan_type NOT IN ('workout','diet') THEN RETURN NEW; END IF;
  v_prefix := CASE WHEN NEW.plan_type = 'diet' THEN 'Diet plan request%' ELSE 'Workout plan request%' END;
  BEGIN
    UPDATE public.tasks
       SET status = 'completed', completed_at = now(),
           assigned_to = COALESCE(assigned_to, NEW.created_by),
           description = COALESCE(description,'') || E'\n\nCompleted automatically: plan "' || COALESCE(NEW.plan_name,'') || '" was sent.'
     WHERE linked_entity_type = 'member' AND linked_entity_id = NEW.member_id
       AND title ILIKE v_prefix AND status IN ('pending','in_progress')
       AND created_at <= NEW.created_at;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'close plan requests failed: %', SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tg_close_plan_requests_on_assign() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_close_plan_requests_on_assign ON public.member_fitness_plans;
CREATE TRIGGER trg_close_plan_requests_on_assign AFTER INSERT ON public.member_fitness_plans
FOR EACH ROW EXECUTE FUNCTION public.tg_close_plan_requests_on_assign();

WITH m AS (
  SELECT t.id, p.plan_name, p.created_by
    FROM public.tasks t
    CROSS JOIN LATERAL (
      SELECT plan_name, created_by FROM public.member_fitness_plans mfp
       WHERE mfp.member_id = t.linked_entity_id
         AND mfp.plan_type = CASE WHEN t.title ILIKE 'Diet plan request%' THEN 'diet' ELSE 'workout' END
         AND mfp.created_at >= t.created_at
       ORDER BY mfp.created_at LIMIT 1) p
   WHERE t.linked_entity_type = 'member' AND t.status IN ('pending','in_progress')
     AND (t.title ILIKE 'Diet plan request%' OR t.title ILIKE 'Workout plan request%'))
UPDATE public.tasks t
   SET status = 'completed', completed_at = now(),
       assigned_to = COALESCE(t.assigned_to, m.created_by),
       description = COALESCE(t.description,'') || E'\n\nCompleted automatically: plan "' || COALESCE(m.plan_name,'') || '" was sent.'
  FROM m WHERE m.id = t.id;