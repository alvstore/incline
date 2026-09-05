ALTER TABLE public.payment_reminders DROP CONSTRAINT IF EXISTS payment_reminders_status_check;
ALTER TABLE public.payment_reminders ADD CONSTRAINT payment_reminders_status_check CHECK (status = ANY (ARRAY['pending'::text,'sent'::text,'failed'::text,'cancelled'::text,'skipped'::text]));
ALTER TABLE public.payment_reminders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS update_payment_reminders_updated_at ON public.payment_reminders;
CREATE TRIGGER update_payment_reminders_updated_at BEFORE UPDATE ON public.payment_reminders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();