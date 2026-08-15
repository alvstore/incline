-- Audit and fix Communication Templates, Staff Roster, and MIPS Access

-- 1. Fix template variable mapping in send-reminders (member_name -> name)
-- The user reported "₹Diya Rajpurohit" in amount slot — this means member_name was passed to a slot expecting amount.
-- Actually, looking at send-reminders code, it passes variables like { member_name: name, amount_due: amountPlain ... }
-- If the Meta template has {{1}} for name and {{2}} for amount, but dispatcher maps {{2}} to member_name because of aliases, it swaps.
-- The dispatcher's resolveVarValue has: if (k.includes('member') || k === 'name') tryKeys.push('member_name', 'name', 'full_name');
-- We need to ensure amount-like keys are prioritized for amount slots.

-- 2. Automation Hub: Slate Template UI
-- The user mentions "slate templates - ui/u missing to submit". This refers to the "Studio" / "AI Generate" flow.
-- The AIGenerateTemplatesDrawer already exists. The user might mean the manual "Meta Sync" or "Submit to Meta" button is missing or broken.
-- Actually, TemplateManager has a "Sync with Meta" button in MetaSyncControls.

-- 3. Staff Roster for dual/single shift
-- We need to ensure we can handle both morning and evening shifts with check-in time.
-- The staff_attendance already has shift_type (morning, evening, night, full_day).
-- But the UI needs to show both clearly.

-- 4. Overdue/Pending Invoice Revoke Access
-- The MIPS sweep_expired function handles this, but it might not be running frequently enough or missing a case.
-- The members_blocked_for_dues RPC checks for 'allowed' = false from member_access_status.

-- 5. Template Mapping
-- The user says "mapping of template is missing manual or auto".
-- This refers to whatsapp_triggers.

-- MIGRATION: Fix Task Trigger and add missing columns if any
-- The 400 error on tasks?columns=... suggests a column mismatch. 
-- The user message shows: branch_id, title, description, priority, status, assigned_to, assigned_by, linked_entity_type, linked_entity_id
-- We should verify if 'status' or 'priority' is missing.

-- Actually, I will check the tasks table schema first.
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tasks';

-- Also check if daily_ops_summary_report template exists in our templates table.
SELECT id, name, meta_template_name, meta_template_status 
FROM public.templates 
WHERE trigger_event = 'daily_ops_summary' OR name ILIKE '%daily%';

-- Fix the Overdue Reminder variable mapping.
-- The user says: "clear the outstanding amount of ₹Diya Rajpurohit".
-- In Meta template: "clear the outstanding amount of ₹{{amount}}".
-- If {{amount}} is the variable, the dispatcher maps it.
-- If the sender sends { member_name: "Diya", amount: "1000" }, but the dispatcher resolves {{1}} to member_name and {{2}} to amount.
-- If the Meta template has {{1}} for amount and {{2}} for name, it swaps.

-- I will update dispatch-communication to be more strict about positional mapping.

-- For Staff Shift:
-- We need to ensure the staff_attendance_history and summary handle multiple punches per day (morning/evening).
