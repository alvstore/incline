-- Enforce IST as the default database timezone
ALTER DATABASE postgres SET timezone TO 'Asia/Kolkata';
SET timezone TO 'Asia/Kolkata';

-- Update branch settings to default to IST if the column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'timezone') THEN
        ALTER TABLE public.branches ALTER COLUMN timezone SET DEFAULT 'Asia/Kolkata';
    END IF;
END $$;