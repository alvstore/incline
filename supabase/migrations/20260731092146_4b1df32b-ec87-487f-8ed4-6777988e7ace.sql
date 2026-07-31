ALTER TABLE public.lockers
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS gender_zone text NOT NULL DEFAULT 'common';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lockers_gender_zone_check'
  ) THEN
    ALTER TABLE public.lockers
      ADD CONSTRAINT lockers_gender_zone_check
      CHECK (gender_zone IN ('male','female','common'));
  END IF;
END $$;

UPDATE public.lockers SET gender_zone = 'common' WHERE gender_zone IS NULL;