CREATE OR REPLACE FUNCTION public.guard_staff_mips_revoke_before_inactive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(OLD.is_active, true) = true
     AND COALESCE(NEW.is_active, true) = false
     AND COALESCE(OLD.mips_sync_status, '') = 'synced'
     AND COALESCE(NEW.mips_sync_status, OLD.mips_sync_status, '') <> 'revoked'
     AND OLD.mips_person_sn IS NOT NULL THEN
    RAISE EXCEPTION 'MIPS access must be revoked before staff can be deactivated. Use the offboarding workflow.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_mips_revoke_before_inactive ON public.employees;
CREATE TRIGGER trg_guard_employee_mips_revoke_before_inactive
BEFORE UPDATE OF is_active, exit_date, exit_type, mips_sync_status
ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.guard_staff_mips_revoke_before_inactive();

DROP TRIGGER IF EXISTS trg_guard_trainer_mips_revoke_before_inactive ON public.trainers;
CREATE TRIGGER trg_guard_trainer_mips_revoke_before_inactive
BEFORE UPDATE OF is_active, exit_date, exit_type, mips_sync_status
ON public.trainers
FOR EACH ROW
EXECUTE FUNCTION public.guard_staff_mips_revoke_before_inactive();