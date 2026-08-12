DO $$
BEGIN
    -- 1. Verify and update the MIPS server URL if it was missing the port or had an incorrect one.
    UPDATE public.mips_connections 
    SET is_active = true 
    WHERE server_url LIKE '%212.38.94.228%';

    -- 2. Reset the sync status for Gate 1 to force a re-discovery/re-sync
    UPDATE public.access_devices
    SET mips_device_id = NULL,
        is_online = false,
        last_reconcile_at = NULL
    WHERE device_name = 'Gate 1' OR serial_number = 'D1146D682A96B1C2';

    -- 3. Clear failed sync attempts for Gate 1 to allow clean retries
    DELETE FROM public.mips_sync_attempts 
    WHERE device_id IN (SELECT id FROM public.access_devices WHERE device_name = 'Gate 1')
    AND status = 'failed'
    AND created_at > now() - interval '1 hour';
END $$;