/**
 * Store / inventory business rules shared by Products, Stock and POS screens.
 * Server mirrors: tg_products_sellable_guard (price > 0 + photo) and adjust_product_stock.
 */

/** Standard Incline product photo, used when staff have no product photo yet. */
export const DEFAULT_PRODUCT_IMAGE = '/images/store/product-default.jpg';

export type StockMode = 'add' | 'remove' | 'set';

export type StockReason =
  | 'count'
  | 'damaged'
  | 'expired'
  | 'internal_use'
  | 'supplier_return'
  | 'correction'
  | 'opening'
  | 'received';

export const STOCK_REASONS: { value: StockReason; label: string; modes: StockMode[] }[] = [
  { value: 'count', label: 'Physical count', modes: ['set', 'add', 'remove'] },
  { value: 'received', label: 'Stock received', modes: ['add'] },
  { value: 'opening', label: 'Opening stock', modes: ['add', 'set'] },
  { value: 'damaged', label: 'Damaged / broken', modes: ['remove'] },
  { value: 'expired', label: 'Expired', modes: ['remove'] },
  { value: 'internal_use', label: 'Gym use / tasting', modes: ['remove'] },
  { value: 'supplier_return', label: 'Returned to supplier', modes: ['remove'] },
  { value: 'correction', label: 'Correction', modes: ['add', 'remove', 'set'] },
];

export function reasonsForMode(mode: StockMode) {
  return STOCK_REASONS.filter((r) => r.modes.includes(mode));
}

/** Resulting stock after an adjustment, or an error message when it is not allowed. */
export function previewAdjustment(
  current: number,
  mode: StockMode,
  quantity: number,
): { next: number; delta: number } | { error: string } {
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) {
    return { error: 'Enter a whole number' };
  }
  if (mode !== 'set' && quantity === 0) return { error: 'Enter a quantity greater than 0' };
  const next = mode === 'add' ? current + quantity : mode === 'remove' ? current - quantity : quantity;
  if (next < 0) return { error: `Only ${current} in stock` };
  return { next, delta: next - current };
}

/** Margin on selling price; null when there is no selling price or no cost yet. */
export function marginPercent(price: number | null | undefined, cost: number | null | undefined): number | null {
  const p = Number(price ?? 0);
  const c = Number(cost ?? 0);
  if (!(p > 0) || !(c > 0)) return null;
  return Math.round(((p - c) / p) * 1000) / 10;
}

export type StockStatus = 'out' | 'low' | 'ok' | 'untracked';

export function stockStatus(quantity: number | null | undefined, minQuantity: number | null | undefined): StockStatus {
  if (quantity === null || quantity === undefined) return 'untracked';
  if (quantity <= 0) return 'out';
  if (quantity <= (minQuantity ?? 5)) return 'low';
  return 'ok';
}

/** Why a product cannot go on POS yet (null = ready). Mirrors the server guard. */
export function posBlocker(p: { price: number | null | undefined; image_url: string | null | undefined }): string | null {
  if (!(Number(p.price ?? 0) > 0)) return 'Set a selling price above ₹0';
  if (!p.image_url) return 'Add a photo or use the standard photo';
  return null;
}

export type PosState = 'live' | 'hidden' | 'needs_setup';

export function posState(p: { is_sellable?: boolean | null; price: number | null | undefined; image_url: string | null | undefined }): PosState {
  if (p.is_sellable) return 'live';
  return posBlocker(p) ? 'needs_setup' : 'hidden';
}

export const MOVEMENT_LABELS: Record<string, string> = {
  sale: 'Sold',
  sale_return: 'Returned (sale cancelled)',
  stock_in: 'Stock received',
  initial: 'Opening stock',
  adjust_in: 'Adjusted up',
  adjust_out: 'Adjusted down',
};

/** +1 for movements that add stock, -1 for ones that remove it. */
export function movementSign(type: string): 1 | -1 {
  return type === 'sale' || type === 'adjust_out' ? -1 : 1;
}
