/**
 * Product options (variants). A parent "group" row holds shared details and is never sold;
 * each option is its own product row with its own SKU, price, photo and stock.
 */

/** Kill switch: set VITE_PRODUCT_VARIANTS=off to hide the options builder and POS grouping. */
export const PRODUCT_VARIANTS_ENABLED = import.meta.env?.VITE_PRODUCT_VARIANTS !== 'off';

export const OPTION_TYPE_PRESETS = ['Flavour', 'Size / Weight', 'Colour', 'Pack'] as const;

export interface VariantDraft {
  value: string;
  sku: string;
  price: string;
  cost_price: string;
  image_url: string;
  swatch_color: string;
  opening_stock: string;
}

export const emptyVariant = (): VariantDraft => ({
  value: '', sku: '', price: '', cost_price: '', image_url: '', swatch_color: '', opening_stock: '',
});

/** Display name stored on each option row, e.g. "Whey Protein — Chocolate". */
export function variantName(parentName: string, value: string) {
  return `${parentName.trim()} — ${value.trim()}`;
}

/** Suggested SKU: base SKU plus an upper-case slug of the option. */
export function suggestSku(baseSku: string, value: string) {
  const slug = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12);
  if (!slug) return '';
  return baseSku.trim() ? `${baseSku.trim().toUpperCase()}-${slug}` : slug;
}

/** First problem with the option list, or null when it can be saved. */
export function validateVariants(variants: VariantDraft[], sellable: boolean): string | null {
  if (variants.length < 2) return 'Add at least 2 options, or switch off "Has options"';
  const seenValues = new Set<string>();
  const seenSkus = new Set<string>();
  for (const [i, v] of variants.entries()) {
    const label = v.value.trim() || `Option ${i + 1}`;
    if (!v.value.trim()) return `Option ${i + 1} needs a name`;
    const key = v.value.trim().toLowerCase();
    if (seenValues.has(key)) return `"${label}" is listed twice`;
    seenValues.add(key);
    const sku = v.sku.trim().toLowerCase();
    if (sku) {
      if (seenSkus.has(sku)) return `SKU ${v.sku.trim()} is used twice`;
      seenSkus.add(sku);
    }
    if (sellable && !(Number(v.price) > 0)) return `${label}: set a selling price above ₹0`;
    if (v.opening_stock && (!Number.isInteger(Number(v.opening_stock)) || Number(v.opening_stock) < 0)) {
      return `${label}: opening stock must be a whole number`;
    }
  }
  return null;
}

/** "₹999" or "₹999 – ₹1,499" for a group card. */
export function priceRange(prices: number[]): string {
  const valid = prices.filter((p) => p > 0);
  if (!valid.length) return '—';
  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}

/** Groups sellable rows: options under their parent id, standalone products on their own. */
export function groupVariants<T extends { id: string; parent_product_id?: string | null }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const r of rows) {
    const key = r.parent_product_id ?? r.id;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key)!.push(r);
  }
  return order.map((key) => ({ key, isGroup: !!rows.find((r) => r.parent_product_id === key), items: groups.get(key)! }));
}
