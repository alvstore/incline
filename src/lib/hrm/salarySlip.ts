import { supabase } from '@/integrations/supabase/client';
import { buildPayslipPdf, downloadBlob, resolveBrandAsync } from '@/utils/pdfBlob';
import { attendanceValues, type PayrollItem } from '@/lib/hrm/payroll';

type PtRow = { installment_id: string; amount: number; member_name: string; payout_month: string; settled: boolean };

/** PT rows that belong on this salary: paid -> settled, saved -> prepared ids, draft -> unsettled. */
export function slipPtRows(item: Pick<PayrollItem, 'status' | 'prepared_installment_ids'>, rows: PtRow[]) {
  return rows.filter(r => item.status === 'paid' ? r.settled
    : item.status === 'processed' ? (item.prepared_installment_ids || []).includes(r.installment_id)
    : !r.settled);
}

/** Download a branded salary slip PDF (PT member commission, advance, bank, remittance). */
export async function downloadSalarySlip(item: PayrollItem, periodStart: string, periodEnd: string, branchId?: string | null) {
  const [{ data: ptData, error: ptErr }, bankRes, brand] = await Promise.all([
    supabase.rpc('payroll_item_pt_breakdown', { p_item_id: item.id }),
    supabase.from(item.staff_kind === 'trainer' ? 'trainers' : 'employees').select('bank_name,bank_account,bank_ifsc').eq('user_id', item.user_id).maybeSingle(),
    resolveBrandAsync(branchId || null),
  ]);
  if (ptErr) throw ptErr;
  const pt = slipPtRows(item, ((ptData || []) as PtRow[]).map(r => ({ ...r, amount: Number(r.amount) })));
  const a = attendanceValues(item);
  const n = (v: unknown) => Number(v || 0);
  const end = item.snapshot_period_end || periodEnd;
  const label = new Date(`${periodStart}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const gross = n(item.final_base) + n(item.final_pt_commission) + n(item.final_ot) + n(item.final_bonus);
  const blob = buildPayslipPdf({
    employee_name: item.profile?.full_name || 'Staff',
    designation: item.staff_kind === 'trainer' ? 'Trainer' : 'Staff',
    period_label: label, period_start: periodStart, period_end: end,
    attendance: { present: a.present, half_day: a.half_day, late: a.late, missing_checkout: a.missing_checkout, leave: a.leave, holiday: a.holiday, weekly_off: a.weekly_off, absent: a.absent, payable_days: a.payable_days, total_days: a.total_days, monthly_salary: a.monthly_salary },
    shifts: { attended: a.shifts_attended, rostered: a.shifts_rostered, missed: a.shifts_missed },
    earnings: { base: n(item.final_base), pt_commission: n(item.final_pt_commission), ot: n(item.final_ot), bonus: n(item.final_bonus) },
    deductions: { deductions: n(item.final_deductions), advance: n(item.final_advance), penalty: n(item.final_penalty) },
    gross, net: n(item.final_net),
    pt_entries: pt.map(r => ({ member_name: r.member_name, payout_month: r.payout_month, amount: r.amount })),
    bank: bankRes.error ? null : bankRes.data,
    payment_method: item.payment_method, payment_reference: item.payment_reference,
    paid_date: item.status === 'paid' ? (item.payment_date || null) : null,
    status: item.status === 'paid' ? 'Paid' : item.status === 'processed' ? 'Saved - awaiting remittance' : 'Draft (not final)',
    notes: item.adjustment_reason,
  }, brand);
  const safe = (item.profile?.full_name || 'staff').replace(/[^a-z0-9]+/gi, '-');
  downloadBlob(blob, `salary-slip-${safe}-${periodStart.slice(0, 7)}.pdf`);
}
