-- Enforce single weekly-off per trainer.
-- A trainer may have at most one weekday with is_weekly_off=true.
-- Uses partial unique index — supports atomic upsert.
CREATE UNIQUE INDEX IF NOT EXISTS staff_shifts_one_weekly_off_per_user_uidx
  ON public.staff_shifts (user_id)
  WHERE is_weekly_off = true;