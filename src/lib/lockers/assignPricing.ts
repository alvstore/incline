export type LockerPriceMode = 'standard' | 'discount' | 'complimentary';
export type DiscountKind = 'flat' | 'percent';

export interface LockerQuoteInput {
  listFee: number;
  gstRate: number;
  mode: LockerPriceMode;
  discountKind: DiscountKind;
  discountValue: number;
  planIncluded: boolean;
}

/** Discount/complimentary off the branch's set price; never a free-typed price. */
export function quoteLockerAssignment(i: LockerQuoteInput) {
  const list = Math.max(0, Number(i.listFee) || 0);
  if (i.planIncluded || i.mode === 'complimentary') {
    return { list, discount: list, taxable: 0, gst: 0, total: 0, free: true };
  }
  let discount = 0;
  if (i.mode === 'discount') {
    const v = Math.max(0, Number(i.discountValue) || 0);
    discount = i.discountKind === 'percent' ? (list * Math.min(v, 100)) / 100 : Math.min(v, list);
  }
  discount = Math.round(discount * 100) / 100;
  const taxable = Math.round((list - discount) * 100) / 100;
  const gst = Math.round(taxable * (Math.max(0, i.gstRate) / 100) * 100) / 100;
  return { list, discount, taxable, gst, total: Math.round((taxable + gst) * 100) / 100, free: taxable === 0 };
}

/** Returns an error message, or null when the assignment can be saved. */
export function validateLockerAssignment(i: LockerQuoteInput & { reason: string }): string | null {
  if (i.planIncluded || i.mode === 'standard') return null;
  if (i.mode === 'discount') {
    const v = Number(i.discountValue) || 0;
    if (v <= 0) return 'Enter a discount amount.';
    if (i.discountKind === 'percent' && v > 100) return 'Discount cannot be more than 100%.';
    if (i.discountKind === 'flat' && v > i.listFee) return 'Discount cannot be more than the locker price.';
  }
  if (i.reason.trim().length < 5) return 'Add a reason (at least 5 characters).';
  return null;
}
