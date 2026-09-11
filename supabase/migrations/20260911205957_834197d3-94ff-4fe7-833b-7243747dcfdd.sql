REVOKE ALL ON FUNCTION public.sync_scan_report_delivery_from_communication() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_scan_report_delivery_from_communication() FROM anon;
REVOKE ALL ON FUNCTION public.sync_scan_report_delivery_from_communication() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_scan_report_delivery_from_communication() TO service_role;