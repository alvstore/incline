/** Official salary slip as returned by my_payslip_for_month (server picks paid > approved > newest draft). */
export interface OfficialSlip {
  id: string; status: string; run_status: string;
  final_base: number; final_pt_commission: number; final_ot: number; final_bonus: number;
  final_deductions: number; final_advance: number; final_penalty: number;
  final_gross: number; final_net: number; calc_base: number | null;
  calc_attendance: Record<string, number> | null;
  payment_method: string | null; payment_date: string | null; updated_at: string | null;
  period_start: string; period_end: string;
}

export type SlipStage = 'paid' | 'approved' | 'draft' | 'none';

/** Display stage only — amounts always come from the slip, never a client estimate. */
export function slipStage(slip: OfficialSlip | null | undefined): SlipStage {
  if (!slip) return 'none';
  if (slip.status === 'paid') return 'paid';
  if (slip.run_status === 'approved' || slip.status === 'approved') return 'approved';
  return 'draft';
}
