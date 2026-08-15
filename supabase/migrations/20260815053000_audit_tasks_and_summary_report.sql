-- 1. Fix Task Trigger Ambiguity
-- Ensure tasks table has all expected columns from the 400 error request
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'linked_entity_type') THEN
        ALTER TABLE public.tasks ADD COLUMN linked_entity_type text;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'linked_entity_id') THEN
        ALTER TABLE public.tasks ADD COLUMN linked_entity_id uuid;
    END IF;
END $$;

-- 2. Register Daily Ops Summary Template Event Mapping
-- Ensure the event_key mapping for daily_ops_summary_report is present
INSERT INTO public.whatsapp_triggers (branch_id, event_name, template_id, is_active)
SELECT b.id, 'daily_ops_summary_report', t.id, true
FROM public.branches b
CROSS JOIN (
    SELECT id FROM public.templates 
    WHERE trigger_event = 'daily_ops_summary' 
       OR name ILIKE '%daily_ops_summary%'
    LIMIT 1
) t
ON CONFLICT (branch_id, event_name) DO UPDATE SET template_id = EXCLUDED.template_id;

-- 3. Hardened access status check for dual-shift staff
-- Ensure staff_attendance has the shift_type column (expected by UI)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'staff_attendance' AND column_name = 'shift_type') THEN
        ALTER TABLE public.staff_attendance ADD COLUMN shift_type text DEFAULT 'full_day';
    END IF;
END $$;

-- 4. Grant Execute on missing functions if any
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
