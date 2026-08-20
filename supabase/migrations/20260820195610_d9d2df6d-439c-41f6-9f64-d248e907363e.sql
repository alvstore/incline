
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT i.id as invoice_id, i.member_id, i.branch_id, i.due_date
        FROM public.invoices i
        WHERE i.id IN ('f1f9333c-909e-46c7-bb60-d2d12d56f996', 'd219b599-a887-47c0-88fa-90058659f342', '49e315e4-4df4-4869-9cad-6c32d6c418c4')
    ) LOOP
        -- WhatsApp Overdue
        IF NOT EXISTS (SELECT 1 FROM public.payment_reminders WHERE invoice_id = r.invoice_id AND channel = 'whatsapp' AND status = 'pending') THEN
            INSERT INTO public.payment_reminders (branch_id, invoice_id, member_id, reminder_type, scheduled_for, status, delivery_status, channel)
            VALUES (r.branch_id, r.invoice_id, r.member_id, 'overdue', now() + interval '1 minute', 'pending', 'scheduled', 'whatsapp');
        END IF;

        -- Email Overdue
        IF NOT EXISTS (SELECT 1 FROM public.payment_reminders WHERE invoice_id = r.invoice_id AND channel = 'email' AND status = 'pending') THEN
            INSERT INTO public.payment_reminders (branch_id, invoice_id, member_id, reminder_type, scheduled_for, status, delivery_status, channel)
            VALUES (r.branch_id, r.invoice_id, r.member_id, 'overdue', now() + interval '2 minutes', 'pending', 'scheduled', 'email');
        END IF;
    END LOOP;
END $$;