export type FreezeMode = 'plan' | 'paid' | 'override';

/** Calendar dates, never browser-local elapsed hours. Freeze end is inclusive. */
export function shiftFreezeDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
}

export function actualFreezeDays(start: string, end: string | null, today: string): number {
  const elapsed = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  if (end === null) return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const planned = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
  return Number.isFinite(elapsed + planned) ? Math.max(0, Math.min(elapsed, planned)) : 0;
}

export function freezeValidation(input: {
  mode: FreezeMode; days: number; reason: string; remaining: number;
  minDays: number; maxDays: number; exceptionsEnabled: boolean; fee: number; openEnded?: boolean;
}): string | null {
  if (input.openEnded) {
    if (input.mode === 'plan') return 'Plan days need a set duration; choose Paid or Exception to freeze until return.';
    if (!input.exceptionsEnabled) return 'Freeze exceptions are disabled for this branch.';
    if (input.mode === 'paid' && !(input.fee > 0)) return 'Enter a freeze fee above ₹0.';
    return input.reason.trim().length < 6 ? 'Enter a reason of at least 6 characters.' : null;
  }
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) return 'Enter 1–365 whole days.';
  if (input.mode !== 'plan' && !input.exceptionsEnabled) return 'Freeze exceptions are disabled for this branch.';
  if (input.mode !== 'override' && (input.days < input.minDays || input.days > input.maxDays)) return `Choose ${input.minDays}–${input.maxDays} days for this branch.`;
  if (input.mode === 'plan' && input.days > input.remaining) return 'Duration exceeds the remaining plan allowance.';
  if (input.mode === 'paid' && !(input.fee > 0)) return 'Enter a freeze fee above ₹0.';
  if (input.reason.trim().length < 6) return 'Enter a reason of at least 6 characters.';
  return null;
}

export function freezeNeedsApproval(mode: FreezeMode, canOverride: boolean, isStaff = true): boolean {
  return !isStaff || (mode !== 'plan' && !canOverride);
}
/** Paid freeze bill: GST on → 18% tax invoice (INV series); off → bill of supply (BOS series). */
export function freezeFeeQuote(fee: number, gst: boolean) {
  const base = Number.isFinite(fee) && fee > 0 ? Math.round(fee * 100) / 100 : 0;
  const tax = gst ? Math.round(base * 18) / 100 : 0;
  return { base, tax, total: Math.round((base + tax) * 100) / 100, series: gst ? 'INV' as const : 'BOS' as const };
}
