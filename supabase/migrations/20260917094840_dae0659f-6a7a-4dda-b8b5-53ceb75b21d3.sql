ALTER TABLE public.howbody_scan_consumptions
  DROP CONSTRAINT IF EXISTS howbody_scan_consumptions_source_check;

ALTER TABLE public.howbody_scan_consumptions
  ADD CONSTRAINT howbody_scan_consumptions_source_check
  CHECK (source IN ('plan', 'gift', 'credit', 'companion', 'none'));