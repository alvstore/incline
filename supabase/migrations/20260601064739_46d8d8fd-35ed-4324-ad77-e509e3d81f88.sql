-- Extend audit trigger to also resolve actor from PostgREST request headers.
-- PostgREST exposes the full incoming request header set as a JSON GUC, which
-- IS scoped to the current HTTP request (works across pooled connections,
-- unlike app-level GUCs we tried first). Edge functions can now forward the
-- caller identity by adding x-actor-id / x-actor-name on the admin client.
CREATE OR REPLACE FUNCTION public.audit_log_trigger_function()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_branch       uuid;
  v_record_pk    uuid;
  v_uid          uuid;
  v_actor_name   text;
  v_actor_source text;
  v_action_desc  text;
  v_old_data     jsonb;
  v_new_data     jsonb;
  v_table_label  text;
  v_headers      jsonb;
  v_header_id    text;
  v_header_name  text;
BEGIN
  v_uid := auth.uid();

  -- Prefer explicit GUC actor id (set by audit_set_actor RPC in cron/triggers).
  IF v_uid IS NULL THEN
    BEGIN
      v_uid := NULLIF(current_setting('app.actor_id', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Fallback: PostgREST per-request headers (forwarded by edge functions).
  IF v_uid IS NULL THEN
    BEGIN
      v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
      v_header_id := v_headers ->> 'x-actor-id';
      IF v_header_id IS NOT NULL AND v_header_id <> '' THEN
        v_uid := v_header_id::uuid;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Actor name resolution: explicit GUC > header > profile > email
  BEGIN
    v_actor_name := NULLIF(current_setting('app.actor_name', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_actor_name := NULL;
  END;

  IF v_actor_name IS NULL THEN
    BEGIN
      IF v_headers IS NULL THEN
        v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
      END IF;
      v_header_name := v_headers ->> 'x-actor-name';
      IF v_header_name IS NOT NULL AND v_header_name <> '' THEN
        v_actor_name := v_header_name;
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  IF v_actor_name IS NULL AND v_uid IS NOT NULL THEN
    BEGIN
      SELECT NULLIF(full_name, '') INTO v_actor_name
      FROM public.profiles WHERE id = v_uid;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  IF v_actor_name IS NULL AND v_uid IS NOT NULL THEN
    BEGIN
      SELECT email INTO v_actor_name
      FROM auth.users WHERE id = v_uid;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Source label for genuine automation rows
  IF v_actor_name IS NULL THEN
    BEGIN
      v_actor_source := NULLIF(current_setting('app.actor_source', true), '');
    EXCEPTION WHEN OTHERS THEN
      v_actor_source := NULL;
    END;
    IF v_actor_source IS NULL THEN
      BEGIN
        IF v_headers IS NULL THEN
          v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
        END IF;
        v_actor_source := v_headers ->> 'x-actor-source';
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    v_actor_name := CASE
      WHEN v_actor_source IS NOT NULL AND v_actor_source <> ''
        THEN 'System (' || v_actor_source || ')'
      ELSE 'System'
    END;
  END IF;

  -- Snapshots, branch, pk
  IF TG_OP = 'INSERT' THEN
    v_old_data := NULL;
    v_new_data := to_jsonb(NEW);
    v_branch   := NEW.branch_id;
    v_record_pk := NEW.id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_data := to_jsonb(OLD);
    v_new_data := to_jsonb(NEW);
    v_branch   := COALESCE(NEW.branch_id, OLD.branch_id);
    v_record_pk := COALESCE(NEW.id, OLD.id);
  ELSE
    v_old_data := to_jsonb(OLD);
    v_new_data := NULL;
    v_branch   := OLD.branch_id;
    v_record_pk := OLD.id;
  END IF;

  v_table_label := replace(TG_TABLE_NAME, '_', ' ');
  v_action_desc := CASE TG_OP
    WHEN 'INSERT' THEN 'Created ' || v_table_label || ' row'
    WHEN 'UPDATE' THEN 'Updated ' || v_table_label || ' row'
    WHEN 'DELETE' THEN 'Deleted ' || v_table_label || ' row'
    ELSE TG_OP || ' ' || v_table_label
  END;

  INSERT INTO public.audit_logs (
    action, table_name, record_id,
    old_data, new_data,
    user_id, branch_id,
    actor_name, action_description
  ) VALUES (
    TG_OP, TG_TABLE_NAME, v_record_pk,
    v_old_data, v_new_data,
    v_uid, v_branch,
    v_actor_name, v_action_desc
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$function$;