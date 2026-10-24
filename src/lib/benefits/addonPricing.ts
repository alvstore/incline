/**
 * Front-desk add-on pricing. The amount typed by staff is what the member pays.
 * Without a tax invoice there is no GST at all (bill of supply); with a tax
 * invoice the GST is taken out of that same amount, so the member pays the same.
 * Mirrors purchase_custom_benefit_credits on the server.
 */
export interface AddonTotals {
  subtotal: number;
  tax: number;
  total: number;
  rate: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeAddonTotals(amount: number, taxInvoice: boolean, gstRate: number): AddonTotals {
  const total = r2(Math.max(0, Number(amount) || 0));
  const rate = taxInvoice ? Math.max(0, Number(gstRate) || 0) : 0;
  const subtotal = r2(total / (1 + rate / 100));
  return { subtotal, tax: r2(total - subtotal), total, rate };
}

/** Whole days from today until the membership end date (inclusive), minimum 1. */
export function daysUntil(endDate: string | null | undefined, today = new Date()): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate}T23:59:59`);
  const diff = Math.ceil((end.getTime() - today.getTime()) / 86_400_000);
  return Math.max(1, diff);
}
