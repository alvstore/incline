-- Backfill: one open slip per person per month (paid wins, else newest draft)
WITH ranked AS (
  SELECT pi.id, row_number() OVER (
    PARTITION BY pi.user_id, date_trunc('month', pr.period_start)
    ORDER BY (pi.status = 'paid') DESC, (pr.status = 'approved') DESC, pi.created_at DESC) rn
  FROM public.payroll_items pi JOIN public.payroll_runs pr ON pr.id = pi.run_id
  WHERE pi.status IS DISTINCT FROM 'cancelled'
)
UPDATE public.payroll_items pi
SET status = 'cancelled',
    adjustment_reason = concat_ws(' | ', nullif(pi.adjustment_reason,''), 'Auto-cancelled: duplicate slip for the same month'),
    updated_at = now()
FROM ranked r WHERE r.id = pi.id AND r.rn > 1 AND pi.status <> 'paid';

-- Runs whose remaining slips are all paid are marked paid
UPDATE public.payroll_runs pr SET status = 'paid', paid_at = coalesce(pr.paid_at, now())
WHERE pr.status <> 'paid'
  AND EXISTS (SELECT 1 FROM public.payroll_items i WHERE i.run_id = pr.id AND i.status = 'paid')
  AND NOT EXISTS (SELECT 1 FROM public.payroll_items i WHERE i.run_id = pr.id AND i.status NOT IN ('paid','cancelled'));

-- Prevent future duplicates
CREATE OR REPLACE FUNCTION public.payroll_items_single_open_slip()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_month date;
BEGIN
  SELECT date_trunc('month', period_start)::date INTO v_month FROM payroll_runs WHERE id = NEW.run_id;
  IF EXISTS (SELECT 1 FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
             WHERE i.user_id = NEW.user_id AND i.id <> NEW.id AND i.status = 'paid'
               AND date_trunc('month', r.period_start)::date = v_month) THEN
    UPDATE payroll_items SET status = 'cancelled',
      adjustment_reason = concat_ws(' | ', nullif(adjustment_reason,''), 'Auto-cancelled: month already paid')
    WHERE id = NEW.id;
  ELSE
    UPDATE payroll_items i SET status = 'cancelled', updated_at = now(),
      adjustment_reason = concat_ws(' | ', nullif(i.adjustment_reason,''), 'Auto-cancelled: replaced by newer slip')
    FROM payroll_runs r
    WHERE r.id = i.run_id AND i.user_id = NEW.user_id AND i.id <> NEW.id
      AND i.status NOT IN ('paid','cancelled')
      AND date_trunc('month', r.period_start)::date = v_month;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.payroll_items_single_open_slip() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_payroll_items_single_open_slip ON public.payroll_items;
CREATE TRIGGER trg_payroll_items_single_open_slip AFTER INSERT ON public.payroll_items
FOR EACH ROW EXECUTE FUNCTION public.payroll_items_single_open_slip();

-- Trainer/staff read their own official slip for a month
CREATE OR REPLACE FUNCTION public.my_payslip_for_month(p_month date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(x) FROM (
    SELECT i.id, i.status, i.final_base, i.final_pt_commission, i.final_ot, i.final_bonus,
           i.final_deductions, i.final_advance, i.final_penalty, i.final_gross, i.final_net,
           i.calc_base, i.calc_attendance, i.payment_method, i.payment_date, i.updated_at,
           r.status AS run_status, r.period_start, r.period_end
    FROM payroll_items i JOIN payroll_runs r ON r.id = i.run_id
    WHERE i.user_id = auth.uid() AND i.status <> 'cancelled'
      AND date_trunc('month', r.period_start) = date_trunc('month', p_month)
    ORDER BY (i.status = 'paid') DESC, (r.status = 'approved') DESC, i.created_at DESC
    LIMIT 1) x
$$;
REVOKE ALL ON FUNCTION public.my_payslip_for_month(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_payslip_for_month(date) TO authenticated;