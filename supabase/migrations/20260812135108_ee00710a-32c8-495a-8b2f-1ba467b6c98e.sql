UPDATE public.access_devices 
SET mips_device_id = 24, is_online = true, last_reconcile_at = now() 
WHERE serial_number = 'D1146D682A96B1C2';

UPDATE public.access_devices 
SET mips_device_id = 25, is_online = true, last_reconcile_at = now() 
WHERE serial_number = 'F06D92740D0062CF';