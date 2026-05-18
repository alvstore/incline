
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.pt_package_status'::regtype AND enumlabel='pending_payment') THEN
    ALTER TYPE public.pt_package_status ADD VALUE 'pending_payment' BEFORE 'active';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid='public.pt_package_status'::regtype AND enumlabel='reversed') THEN
    ALTER TYPE public.pt_package_status ADD VALUE 'reversed' AFTER 'cancelled';
  END IF;
END$$;
