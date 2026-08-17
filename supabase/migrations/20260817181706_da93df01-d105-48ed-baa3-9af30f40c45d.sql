-- Enforce IST for all database roles to ensure consistent local time handling
ALTER ROLE authenticated SET timezone TO 'Asia/Kolkata';
ALTER ROLE anon SET timezone TO 'Asia/Kolkata';
ALTER ROLE service_role SET timezone TO 'Asia/Kolkata';

-- Update branch settings to default to IST if the column exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'timezone') THEN
        ALTER TABLE public.branches ALTER COLUMN timezone SET DEFAULT 'Asia/Kolkata';
    END IF;
END $$;