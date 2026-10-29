CREATE OR REPLACE FUNCTION public.normalize_exercise_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.attach_exercise_media_list(p_list jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE ex jsonb; out jsonb := '[]'::jsonb; lib record;
BEGIN
  IF p_list IS NULL OR jsonb_typeof(p_list) <> 'array' THEN RETURN p_list; END IF;
  FOR ex IN SELECT * FROM jsonb_array_elements(p_list) LOOP
    IF jsonb_typeof(ex) = 'object'
       AND coalesce(ex->>'video_url','') = '' AND coalesce(ex->>'video_file_path','') = ''
       AND coalesce(ex->>'video_auto','') <> 'off' THEN
      SELECT video_url, thumbnail_url, external_id INTO lib
        FROM public.exercise_video_library
       WHERE active AND normalized_name = public.normalize_exercise_name(ex->>'name') LIMIT 1;
      IF FOUND AND lib.video_url IS NOT NULL THEN
        -- Only media keys are added; name/equipment (our machine names) are never changed.
        ex := ex || jsonb_build_object('video_url', lib.video_url, 'poster_url', lib.thumbnail_url,
                                       'video_source', 'library', 'video_ref', lib.external_id);
      END IF;
    END IF;
    out := out || jsonb_build_array(ex);
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.attach_exercise_media(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r jsonb := p; wi int; di int;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN p; END IF;
  IF jsonb_typeof(r->'weeks') = 'array' THEN
    FOR wi IN 0 .. jsonb_array_length(r->'weeks') - 1 LOOP
      IF jsonb_typeof(r->'weeks'->wi->'days') = 'array' THEN
        FOR di IN 0 .. jsonb_array_length(r->'weeks'->wi->'days') - 1 LOOP
          IF r->'weeks'->wi->'days'->di ? 'exercises' THEN
            r := jsonb_set(r, ARRAY['weeks', wi::text, 'days', di::text, 'exercises'],
                   public.attach_exercise_media_list(r->'weeks'->wi->'days'->di->'exercises'));
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  IF jsonb_typeof(r->'days') = 'array' THEN
    FOR di IN 0 .. jsonb_array_length(r->'days') - 1 LOOP
      IF r->'days'->di ? 'exercises' THEN
        r := jsonb_set(r, ARRAY['days', di::text, 'exercises'],
               public.attach_exercise_media_list(r->'days'->di->'exercises'));
      END IF;
    END LOOP;
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.tg_attach_exercise_media_template()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type = 'workout' THEN NEW.content := public.attach_exercise_media(NEW.content); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_attach_exercise_media_member_plan()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.plan_type = 'workout' THEN NEW.plan_data := public.attach_exercise_media(NEW.plan_data); END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.attach_exercise_media(jsonb), public.attach_exercise_media_list(jsonb),
  public.tg_attach_exercise_media_template(), public.tg_attach_exercise_media_member_plan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_exercise_name(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_exercise_media(jsonb), public.attach_exercise_media_list(jsonb) TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_attach_exercise_media ON public.fitness_plan_templates;
CREATE TRIGGER trg_attach_exercise_media BEFORE INSERT OR UPDATE OF content, type ON public.fitness_plan_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_attach_exercise_media_template();
DROP TRIGGER IF EXISTS trg_attach_exercise_media ON public.member_fitness_plans;
CREATE TRIGGER trg_attach_exercise_media BEFORE INSERT OR UPDATE OF plan_data, plan_type ON public.member_fitness_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_attach_exercise_media_member_plan();