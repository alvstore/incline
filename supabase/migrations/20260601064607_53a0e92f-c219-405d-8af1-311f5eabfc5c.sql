-- 1) Helper RPC to pin actor name + id for the current statement context
--    Called from edge functions running with the service-role key so
--    audit_log_trigger_function can persist the real user instead of "System".
CREATE OR REPLACE FUNCTION public.audit_set_actor(
  p_actor_id uuid,
  p_actor_name text DEFAULT NULL,
  p_source text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('app.actor_id', COALESCE(p_actor_id::text, ''), true);
  PERFORM set_config('app.actor_name', COALESCE(NULLIF(p_actor_name, ''), ''), true);
  PERFORM set_config('app.actor_source', COALESCE(NULLIF(p_source, ''), ''), true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_set_actor(uuid, text, text) TO authenticated, service_role;

-- 2) Extend the generic audit trigger to honor app.actor_id GUC (when auth.uid() is null)
--    and to label automation more meaningfully than just "System".
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
  v_guc_id_raw   text;
BEGIN
  v_uid := auth.uid();

  -- Actor id GUC fallback (set by edge functions via audit_set_actor)
  BEGIN
    v_guc_id_raw := NULLIF(current_setting('app.actor_id', true), '');
    IF v_uid IS NULL AND v_guc_id_raw IS NOT NULL THEN
      v_uid := v_guc_id_raw::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- ignore malformed GUC
  END;

  -- Actor name: explicit GUC > profile lookup > auth.users.email
  BEGIN
    v_actor_name := NULLIF(current_setting('app.actor_name', true), '');
  EXCEPTION WHEN OTHERS THEN
    v_actor_name := NULL;
  END;

  IF v_actor_name IS NULL AND v_uid IS NOT NULL THEN
    BEGIN
      SELECT NULLIF(full_name, '') INTO v_actor_name
      FROM public.profiles WHERE id = v_uid;
    EXCEPTION WHEN OTHERS THEN
      v_actor_name := NULL;
    END;
  END IF;

  IF v_actor_name IS NULL AND v_uid IS NOT NULL THEN
    BEGIN
      SELECT email INTO v_actor_name
      FROM auth.users WHERE id = v_uid;
    EXCEPTION WHEN OTHERS THEN
      v_actor_name := NULL;
    END;
  END IF;

  -- Distinguish genuine automation (cron, trigger cascades) from anonymous "System".
  IF v_actor_name IS NULL THEN
    BEGIN
      v_actor_source := NULLIF(current_setting('app.actor_source', true), '');
    EXCEPTION WHEN OTHERS THEN
      v_actor_source := NULL;
    END;
    v_actor_name := CASE
      WHEN v_actor_source IS NOT NULL THEN 'System (' || v_actor_source || ')'
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
  ELSE -- DELETE
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

-- 3) Add a column to whatsapp_templates capturing the last Meta error
--    (132001, 132000, 131051, …) for surface in the Templates Hub banner.
ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS meta_last_error text,
  ADD COLUMN IF NOT EXISTS meta_last_verified_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_stale
  ON public.whatsapp_templates (is_stale)
  WHERE is_stale = true;

-- 4) Backfill recent audit logs where user_id is known but actor_name was lost
UPDATE public.audit_logs a
   SET actor_name = COALESCE(p.full_name, u.email, a.actor_name)
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
 WHERE a.created_at > now() - interval '90 days'
   AND (a.actor_name IS NULL OR a.actor_name = 'System')
   AND a.user_id IS NOT NULL
   AND p.id = a.user_id;