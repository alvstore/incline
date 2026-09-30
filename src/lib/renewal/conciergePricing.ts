/**
 * Pricing helpers for the member-facing Renewal Concierge.
 *
 * Catalogue prices can be stored GST-inclusive or GST-exclusive, so the
 * receipt the member sees is always derived from the plan/package row — never
 * from a hard-coded tax rate.
 */

export interface PriceBreakdown {
  /** Amount before tax. */
  base: number;
  /** Tax amount in INR. */
  tax: number;
  /** What the member actually pays. */
  total: number;
  /** Applied GST percentage. */
  rate: number;
}

export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Split a catalogue price into base + GST.
 * `inclusive` prices are back-calculated so the member's total never changes.
 */
export function splitGst(price: number, rate: number | null | undefined, inclusive: boolean): PriceBreakdown {
  const safePrice = Number.isFinite(price) ? price : 0;
  const safeRate = Number.isFinite(Number(rate)) ? Number(rate) : 0;

  if (safeRate <= 0) {
    return { base: round2(safePrice), tax: 0, total: round2(safePrice), rate: 0 };
  }

  if (inclusive) {
    const base = safePrice / (1 + safeRate / 100);
    return { base: round2(base), tax: round2(safePrice - base), total: round2(safePrice), rate: safeRate };
  }

  const tax = safePrice * (safeRate / 100);
  return { base: round2(safePrice), tax: round2(tax), total: round2(safePrice + tax), rate: safeRate };
}

/** Plain-language urgency wording for a membership end date. */
export function expiryTone(daysRemaining: number, hasMembership: boolean): {
  label: string;
  tone: 'good' | 'soon' | 'urgent' | 'none';
} {
  if (!hasMembership) return { label: 'No active membership', tone: 'none' };
  if (daysRemaining <= 0) return { label: 'Expires today', tone: 'urgent' };
  if (daysRemaining === 1) return { label: 'Expires tomorrow', tone: 'urgent' };
  if (daysRemaining <= 14) return { label: `Expires in ${daysRemaining} days`, tone: 'soon' };
  return { label: `${daysRemaining} days remaining`, tone: 'good' };
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** New end date after extending an existing membership by a plan's duration. */
export function extendedEndDate(currentEnd: string | null | undefined, durationDays: number): string {
  const from = currentEnd ? new Date(currentEnd) : new Date();
  const base = Number.isNaN(from.getTime()) || from.getTime() < Date.now() ? new Date() : from;
  const next = new Date(base.getTime() + durationDays * 86_400_000);
  return next.toISOString();
}
