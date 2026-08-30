DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'staff_primary_branch','assert_can_manage_staff_attendance',
        'staff_mark_manual_attendance','staff_correct_attendance','staff_delete_attendance',
        'staff_mark_block','payroll_reopen_run','payroll_recalculate_item',
        'tg_flag_payroll_attendance_change'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'staff_primary_branch','assert_can_manage_staff_attendance',
        'staff_mark_manual_attendance','staff_correct_attendance','staff_delete_attendance',
        'staff_mark_block','payroll_reopen_run','payroll_recalculate_item'
      )
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;