-- v2.15.0 — MIPS access dispatch coalescing + per-member lock + echo suppression
-- Root cause (21 Sep 2026): one purchase transaction produced 4 hardware_access_events
-- rows + membership webhook + member webhook = up to 8 parallel mips-access
-- invocations for the same member, some carrying 'revoke' for the transient
-- 'pending' state. Workers overwrote each other's validTimeEnd and every
-- hardware_access_status flip they wrote re-fired fn_mips_person_webhook.
-- MIPS ledger: 31 gate jobs for one member in 4 minutes; terminal app restarted.

-- ---------------------------------------------------------------------------
-- 1. Per-member lock table (service-role only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mips_member_locks (
  member_id uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  locked_until timestamptz,
  locked_by text,
  rerun_requested boolean NOT NULL DEFAULT false,
  rerun_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.mips_member_locks FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mips_member_locks TO service_role;
ALTER TABLE public.mips_member_locks ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service_role (bypasses RLS) may touch it.

-- ---------------------------------------------------------------------------
-- 2. Lock acquire / release RPCs (coalescing semantics)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mips_member_lock_acquire(
  p_member_id uuid,
  p_owner text,
  p_ttl_seconds integer DEFAULT 90,
  p_reason text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mips_member_locks%ROWTYPE;
BEGIN
  IF p_member_id IS NULL THEN
    RETURN 'acquired';
  END IF;

  INSERT INTO public.mips_member_locks (member_id, locked_until, locked_by, rerun_requested, rerun_reason)
  VALUES (p_member_id, now() + make_interval(secs => GREATEST(p_ttl_seconds, 5)), p_owner, false, NULL)
  ON CONFLICT (member_id) DO NOTHING;

  SELECT * INTO v_row FROM public.mips_member_locks WHERE member_id = p_member_id FOR UPDATE;

  IF v_row.locked_until IS NULL OR v_row.locked_until < now() OR v_row.locked_by = p_owner THEN
    UPDATE public.mips_member_locks
       SET locked_until = now() + make_interval(secs => GREATEST(p_ttl_seconds, 5)),
           locked_by = p_owner,
           rerun_requested = false,
           rerun_reason = NULL,
           updated_at = now()
     WHERE member_id = p_member_id;
    RETURN 'acquired';
  END IF;

  -- Someone else is working on this member: ask them to re-check once they finish.
  UPDATE public.mips_member_locks
     SET rerun_requested = true,
         rerun_reason = COALESCE(p_reason, rerun_reason),
         updated_at = now()
   WHERE member_id = p_member_id;
  RETURN 'busy';
END;
$$;

CREATE OR REPLACE FUNCTION public.mips_member_lock_release(
  p_member_id uuid,
  p_owner text,
  p_keep_if_rerun boolean DEFAULT true
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rerun boolean := false;
BEGIN
  IF p_member_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT rerun_requested INTO v_rerun
    FROM public.mips_member_locks
   WHERE member_id = p_member_id AND locked_by = p_owner
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_rerun AND p_keep_if_rerun THEN
    -- Caller loops once more while still holding the lock.
    UPDATE public.mips_member_locks
       SET rerun_requested = false, rerun_reason = NULL,
           locked_until = now() + interval '90 seconds', updated_at = now()
     WHERE member_id = p_member_id;
    RETURN true;
  END IF;

  UPDATE public.mips_member_locks
     SET locked_until = NULL, locked_by = NULL,
         rerun_requested = false, rerun_reason = NULL, updated_at = now()
   WHERE member_id = p_member_id;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.mips_member_lock_acquire(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mips_member_lock_release(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mips_member_lock_acquire(uuid, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mips_member_lock_release(uuid, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Echo-suppressed state writer for the worker
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mips_set_member_hardware_state(
  p_member_id uuid,
  p_status text,
  p_reason text DEFAULT NULL,
  p_clear_requires_sync boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Transaction-local flag read by fn_mips_person_webhook / enqueue: the worker
  -- is reconciling CRM state to what the gate already holds, so no re-dispatch.
  PERFORM set_config('mips.suppress_access_webhook', 'on', true);

  UPDATE public.members
     SET hardware_access_status = p_status,
         hardware_access_reason = p_reason,
         updated_at = now()
   WHERE id = p_member_id
     AND (hardware_access_status IS DISTINCT FROM p_status
          OR hardware_access_reason IS DISTINCT FROM p_reason);

  IF p_clear_requires_sync THEN
    UPDATE public.hardware_access_events
       SET requires_sync = false
     WHERE member_id = p_member_id AND requires_sync = true;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mips_set_member_hardware_state(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mips_set_member_hardware_state(uuid, text, text, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Coalesced enqueue: ONE evaluate per member per transaction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.mips_enqueue_member_access(
  p_member_id uuid,
  p_branch_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public, extensions
AS $$
DECLARE
  v_seen text;
  v_key text;
BEGIN
  IF p_member_id IS NULL THEN
    RETURN;
  END IF;

  -- The worker's own reconciliation writes must not echo back into a dispatch.
  IF coalesce(current_setting('mips.suppress_access_webhook', true), '') = 'on' THEN
    RETURN;
  END IF;

  v_key := p_member_id::text;
  v_seen := coalesce(current_setting('mips.access_enqueued', true), '');
  IF position(v_key in v_seen) > 0 THEN
    RETURN; -- already queued in this transaction
  END IF;
  PERFORM set_config('mips.access_enqueued', v_seen || ',' || v_key, true);

  -- action=evaluate: the worker derives revoke/restore from the COMMITTED final
  -- state, so intermediate rows (pending/expired) can never revoke a paid member.
  PERFORM private.mips_dispatch('mips-access', jsonb_build_object(
    'action', 'evaluate',
    'member_id', p_member_id,
    'branch_id', p_branch_id,
    'reason', coalesce(p_reason, 'access state change'),
    'source', 'db-coalesced'
  ));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'mips_enqueue_member_access failed for %: %', p_member_id, SQLERRM;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Route the three member paths through the coalesced enqueue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_sync_hardware_access_to_mips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
BEGIN
  IF NEW.member_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM private.mips_enqueue_member_access(NEW.member_id, NEW.branch_id, COALESCE(NEW.reason, 'access state change'));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'tg_sync_hardware_access_to_mips failed for %: %', NEW.member_id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mips_membership_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_branch uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date THEN
    RETURN NEW;
  END IF;

  SELECT branch_id INTO v_branch FROM public.members WHERE id = NEW.member_id;
  PERFORM private.mips_enqueue_member_access(
    NEW.member_id,
    coalesce(NEW.branch_id, v_branch),
    'DB webhook: membership ' || NEW.status::text
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_mips_membership_webhook failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mips_person_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, extensions
AS $$
DECLARE
  v_person_type text;
  v_photo_changed boolean := false;
  v_avatar_changed boolean := false;
  v_due_changed boolean := false;
  v_changed jsonb;
  v_revoke boolean := false;
BEGIN
  v_person_type := CASE TG_TABLE_NAME
    WHEN 'members' THEN 'member'
    WHEN 'employees' THEN 'employee'
    ELSE 'trainer' END;

  IF TG_OP = 'INSERT' THEN
    v_photo_changed := NEW.biometric_photo_path IS NOT NULL;
  ELSE
    v_photo_changed :=
      NEW.biometric_photo_path IS DISTINCT FROM OLD.biometric_photo_path
      OR NEW.mips_photo_hash IS DISTINCT FROM OLD.mips_photo_hash;
    v_avatar_changed :=
      NEW.biometric_photo_url IS DISTINCT FROM OLD.biometric_photo_url
      OR NEW.avatar_storage_path IS DISTINCT FROM OLD.avatar_storage_path;
  END IF;

  IF TG_TABLE_NAME = 'members' THEN
    IF TG_OP = 'UPDATE' THEN
      v_due_changed :=
        NEW.hardware_access_status IS DISTINCT FROM OLD.hardware_access_status
        OR NEW.hardware_access_enabled IS DISTINCT FROM OLD.hardware_access_enabled
        OR NEW.status IS DISTINCT FROM OLD.status;
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      v_due_changed :=
        NEW.is_active IS DISTINCT FROM OLD.is_active
        OR NEW.exit_date IS DISTINCT FROM OLD.exit_date;
      v_revoke := coalesce(NEW.is_active, true) = false OR NEW.exit_date IS NOT NULL;
    END IF;
  END IF;

  IF NOT (v_photo_changed OR v_due_changed) THEN
    RETURN NEW;
  END IF;

  v_changed := jsonb_build_object(
    'photo_changed', v_photo_changed,
    'avatar_changed', v_avatar_changed,
    'due_changed', v_due_changed
  );

  IF v_due_changed THEN
    IF TG_TABLE_NAME = 'members' THEN
      -- Coalesced + echo-suppressed; the worker derives revoke/restore itself.
      PERFORM private.mips_enqueue_member_access(NEW.id, NEW.branch_id, 'DB webhook: access state changed');
    ELSE
      PERFORM private.mips_dispatch('mips-access', jsonb_build_object(
        'action', CASE WHEN v_revoke THEN 'revoke_staff' ELSE 'restore_staff' END,
        'person_type', v_person_type,
        'person_id', NEW.id,
        'branch_id', NEW.branch_id,
        'reason', 'DB webhook: staff state changed',
        'changed_fields', v_changed
      ));
    END IF;
  END IF;

  IF v_photo_changed AND coalesce(NEW.mips_sync_status, '') = 'photo_rejected' THEN
    EXECUTE format('UPDATE public.%I SET mips_sync_status = %L WHERE id = %L',
                   TG_TABLE_NAME, 'pending', NEW.id);
    NEW.mips_sync_status := 'pending';
  END IF;

  IF v_photo_changed
     AND coalesce(NEW.mips_sync_status, '') NOT IN ('photo_rejected', 'revoked') THEN
    PERFORM private.mips_dispatch('sync-to-mips', jsonb_build_object(
      'person_type', v_person_type,
      'person_id', NEW.id,
      'branch_id', NEW.branch_id,
      'deploy_to_devices', true,
      'changed_fields', v_changed
    ));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_mips_person_webhook failed for %.%: %', TG_TABLE_NAME, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;