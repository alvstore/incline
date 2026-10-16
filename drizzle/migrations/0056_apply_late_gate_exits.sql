CREATE OR REPLACE FUNCTION public.apply_late_gate_exits(p_since timestamptz DEFAULT now() - interval '24 hours')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record; v_res jsonb; v_n int := 0;
BEGIN
  -- Re-apply exit-gate scans (oldest first) so exits that arrived before their entry
  -- (outage replays) still close the visit at the gate's own scan time.
  FOR r IN
    SELECT l.id, l.member_id, l.branch_id, l.captured_at
    FROM access_logs l
    JOIN access_devices d ON d.serial_number = l.device_sn AND d.door_role = 'exit'
    WHERE l.member_id IS NOT NULL AND l.captured_at >= p_since AND l.captured_at <= now()
      AND NOT EXISTS (SELECT 1 FROM member_attendance a WHERE a.member_id = l.member_id
                      AND a.check_out IS NOT NULL AND a.check_out >= l.captured_at
                      AND a.check_in <= l.captured_at)
    ORDER BY l.captured_at
  LOOP
    v_res := public.member_gate_check_out(r.member_id, r.branch_id, r.captured_at);
    IF (v_res->>'success')::boolean THEN
      v_n := v_n + 1;
      INSERT INTO audit_logs (branch_id, action, table_name, record_id, new_data, actor_name, action_description)
      VALUES (r.branch_id, 'UPDATE', 'member_attendance', (v_res->>'attendance_id')::uuid,
              jsonb_build_object('check_out', r.captured_at, 'access_log_id', r.id), 'System',
              'Late exit scan applied at gate scan time');
    END IF;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.apply_late_gate_exits(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_late_gate_exits(timestamptz) TO service_role;