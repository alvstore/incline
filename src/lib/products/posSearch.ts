/** Normalise text for counter search: drop ™/®/punctuation and spaces, lowercase. */
export function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * True when every typed word appears somewhere in the product's name, brand or SKU,
 * in any order. "muscle tech glutamine" matches "Muscletech™ Platinum Glutamine".
 */
export function matchesProductSearch(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const words = query.split(/\s+/).map(normalizeSearchText).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.map(normalizeSearchText).join('|');
  const joined = normalizeSearchText(query);
  if (joined && haystack.includes(joined)) return true;
  return words.every((w) => haystack.includes(w));
}

export interface ManualDiscountInput {
  subtotal: number;
  couponDiscount: number;
  mode: 'amount' | 'percent';
  value: number;
}

/** Rupee value of a manual discount, capped so the bill never goes below zero. */
export function computeManualDiscount({ subtotal, couponDiscount, mode, value }: ManualDiscountInput): number {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  const room = Math.max(0, subtotal - couponDiscount);
  const raw = mode === 'percent' ? (subtotal * Math.min(v, 100)) / 100 : v;
  return Math.round(Math.min(raw, room) * 100) / 100;
}
