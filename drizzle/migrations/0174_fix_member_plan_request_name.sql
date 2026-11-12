CREATE OR REPLACE FUNCTION public.create_member_plan_request(_kind text, _note text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_m record; v_label text; v_existing record; v_trainer_uid uuid; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _kind NOT IN ('diet','workout') THEN RAISE EXCEPTION 'Invalid request type'; END IF;
  v_label := CASE WHEN _kind = 'diet' THEN 'Diet' ELSE 'Workout' END;

  SELECT m.id, m.branch_id, p.full_name, m.assigned_trainer_id INTO v_m
    FROM members m LEFT JOIN profiles p ON p.id = m.user_id
   WHERE m.user_id = v_uid LIMIT 1;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Member profile not found'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('plan_req:' || v_m.id || ':' || _kind));

  SELECT id, created_at, description INTO v_existing FROM tasks
   WHERE linked_entity_type = 'member' AND linked_entity_id = v_m.id
     AND title ILIKE v_label || ' plan request%'
     AND status IN ('pending','in_progress')
   ORDER BY created_at ASC LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    IF coalesce(btrim(_note),'') <> '' AND position(btrim(_note) IN coalesce(v_existing.description,'')) = 0 THEN
      UPDATE tasks SET description = coalesce(description,'') || E'\n\nMember update (' ||
        to_char(now() AT TIME ZONE 'Asia/Kolkata','DD Mon') || '): ' || btrim(_note), updated_at = now()
       WHERE id = v_existing.id;
    END IF;
    RETURN jsonb_build_object('success', false, 'duplicate_of', v_existing.id,
      'message', 'You already have a ' || _kind || ' plan request open since ' ||
        to_char(v_existing.created_at AT TIME ZONE 'Asia/Kolkata','DD Mon') ||
        '. Your trainer will send it soon.');
  END IF;

  IF v_m.assigned_trainer_id IS NOT NULL THEN
    SELECT user_id INTO v_trainer_uid FROM trainers WHERE id = v_m.assigned_trainer_id;
  END IF;

  INSERT INTO tasks (branch_id, title, description, priority, status, assigned_to, assigned_by,
                     linked_entity_type, linked_entity_id)
  VALUES (v_m.branch_id, v_label || ' plan request from ' || coalesce(v_m.full_name,'member'),
          coalesce(nullif(btrim(_note),''), 'Member ' || coalesce(v_m.full_name,'') || ' has requested a new ' || _kind || ' plan.'),
          'medium', 'pending', v_trainer_uid, v_uid, 'member', v_m.id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('success', true, 'task_id', v_id, 'assigned_to', v_trainer_uid);
END $function$;