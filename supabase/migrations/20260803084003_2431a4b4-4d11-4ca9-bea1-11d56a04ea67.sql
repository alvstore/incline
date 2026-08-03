DO $$
DECLARE
  v_user uuid := '49d37deb-7b84-4f04-853c-0ba90619bab3';
  v_branch uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- Link historical unresolved punches to the trainer profile
  UPDATE public.access_logs
  SET profile_id = v_user,
      branch_id = COALESCE(branch_id, v_branch),
      result = 'trainer',
      message = 'Trainer Puneet Meghwal scanned (backfilled alias personId 99)'
  WHERE payload->>'personId' = '99'
    AND profile_id IS NULL;

  -- Rebuild attendance days from the punch stream (IST day buckets)
  ALTER TABLE public.staff_attendance DISABLE TRIGGER trg_notify_late_attendance;

  INSERT INTO public.staff_attendance (user_id, branch_id, check_in, check_out, shift_date, notes)
  SELECT v_user, v_branch, d.first_punch,
         CASE WHEN d.last_punch > d.first_punch THEN d.last_punch END,
         d.day,
         'Backfilled from MIPS punches (legacy device id 99)'
  FROM (
    SELECT (a.captured_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           MIN(a.captured_at) AS first_punch,
           MAX(a.captured_at) AS last_punch
    FROM public.access_logs a
    WHERE a.payload->>'personId' = '99'
      AND a.profile_id = v_user
    GROUP BY 1
  ) d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.staff_attendance sa
    WHERE sa.user_id = v_user AND sa.shift_date = d.day
  );

  ALTER TABLE public.staff_attendance ENABLE TRIGGER trg_notify_late_attendance;
END $$;