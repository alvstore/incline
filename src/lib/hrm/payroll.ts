import type { Database } from '@/integrations/supabase/types';

export type PayrollItem = Database['public']['Tables']['payroll_items']['Row'] & {
  profile?: { full_name: string | null; email?: string | null; avatar_url?: string | null };
};

export function payrollPeriod(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Select a valid payroll month');
  const [year, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${days}`, days };
}

export function payrollNet(values: { base: number; pt: number; ot: number; bonus: number; deductions: number; advance: number; penalty: number }) {
  return Math.round((values.base + values.pt + values.ot + values.bonus - values.deductions - values.advance - values.penalty) * 100) / 100;
}

export function attendanceValues(item: PayrollItem): Record<string, number> {
  const data = item.calc_attendance;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === 'number')) as Record<string, number>;
}

export function payrollPaymentBlocker(method: string, reference: string, date: string, today: string) {
  if (!['cash', 'bank_transfer', 'upi', 'cheque'].includes(method)) return 'Choose a supported payment method';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || date > today) return 'Choose a payment date no later than today';
  if (method !== 'cash' && !reference.trim()) return 'Enter the UTR / payment reference';
  return null;
}

export function preferredPayrollRun<T extends { id: string; status: string }>(runs: T[], paidRunIds: Set<string>, selected: string | null) {
  return runs.find(r => r.id === selected)?.id || runs.find(r => paidRunIds.has(r.id))?.id || runs[0]?.id || null;
}

export function payrollRunBranch(selectedBranch: string): string | null {
  return selectedBranch === 'all' ? null : selectedBranch;
}