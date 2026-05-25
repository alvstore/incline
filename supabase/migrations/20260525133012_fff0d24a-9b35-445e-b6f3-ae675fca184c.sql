
CREATE OR REPLACE FUNCTION public.tg_block_manager_self_edit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_target uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF v_actor <> v_target THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- If actor is owner or admin, allow.
  IF public.has_role(v_actor, 'owner'::app_role) OR public.has_role(v_actor, 'admin'::app_role) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- If actor is a manager (and not owner/admin), block self-edits.
  IF public.has_role(v_actor, 'manager'::app_role) THEN
    RAISE EXCEPTION 'Managers cannot edit their own roster. Ask another manager, admin, or owner.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_block_manager_self_edit_shifts ON public.staff_shifts;
CREATE TRIGGER tg_block_manager_self_edit_shifts
BEFORE INSERT OR UPDATE OR DELETE ON public.staff_shifts
FOR EACH ROW EXECUTE FUNCTION public.tg_block_manager_self_edit();

DROP TRIGGER IF EXISTS tg_block_manager_self_edit_overrides ON public.staff_shift_overrides;
CREATE TRIGGER tg_block_manager_self_edit_overrides
BEFORE INSERT OR UPDATE OR DELETE ON public.staff_shift_overrides
FOR EACH ROW EXECUTE FUNCTION public.tg_block_manager_self_edit();
