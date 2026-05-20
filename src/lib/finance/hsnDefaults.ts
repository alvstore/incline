/**
 * Default HSN / SAC codes for Indian GST compliance.
 * Gym / fitness club specific.
 *
 * Resolution order at report time:
 *   1. invoice_items.hsn_code
 *   2. products.hsn_code (when source = POS)
 *   3. category map below
 *   4. organization_settings.hsn_defaults (JSONB override)
 *   5. fallback (999723 @ 18%)
 */

export type HsnEntry = {
  code: string;
  description: string;
  rate: number; // percent
  uqc: string;  // unit of quantity code (GSTR-1)
};

export const HSN_FALLBACK: HsnEntry = {
  code: '999723',
  description: 'Physical well-being incl. health club & fitness centre services',
  rate: 18,
  uqc: 'NOS',
};

export const HSN_CATEGORY_MAP: Record<string, HsnEntry> = {
  membership: { code: '999723', description: 'Health & fitness club services', rate: 18, uqc: 'NOS' },
  pt_package: { code: '999723', description: 'Personal training services', rate: 18, uqc: 'NOS' },
  class:      { code: '999723', description: 'Group class services', rate: 18, uqc: 'NOS' },
  addon:      { code: '999723', description: 'Add-on services', rate: 18, uqc: 'NOS' },
  benefit:    { code: '999723', description: 'Member benefit services', rate: 18, uqc: 'NOS' },
  // POS retail
  pos:           { code: '2106',  description: 'Food preparations (supplements)', rate: 18, uqc: 'NOS' },
  supplement:    { code: '2106',  description: 'Protein / nutritional supplements', rate: 18, uqc: 'KGS' },
  apparel:       { code: '6109',  description: 'Apparel & sportswear', rate: 12, uqc: 'NOS' },
  equipment:     { code: '9506',  description: 'Fitness equipment / accessories', rate: 18, uqc: 'NOS' },
  beverage:      { code: '2202',  description: 'Beverages', rate: 28, uqc: 'NOS' },
};

export function resolveHsn(opts: {
  itemHsn?: string | null;
  productHsn?: string | null;
  category?: string | null;
  source?: string | null;
  rateOverride?: number | null;
  orgDefaults?: Record<string, HsnEntry> | null;
}): HsnEntry {
  const { itemHsn, productHsn, category, source, rateOverride, orgDefaults } = opts;

  // explicit codes win
  const explicit = itemHsn || productHsn;
  if (explicit) {
    return {
      code: explicit,
      description: HSN_CATEGORY_MAP[category || '']?.description || 'Goods / Services',
      rate: rateOverride ?? HSN_CATEGORY_MAP[category || '']?.rate ?? 18,
      uqc: HSN_CATEGORY_MAP[category || '']?.uqc || 'NOS',
    };
  }

  const key = (category || source || '').toLowerCase();
  if (orgDefaults?.[key]) return orgDefaults[key];
  if (HSN_CATEGORY_MAP[key]) return HSN_CATEGORY_MAP[key];
  // POS sale with no info → supplements default
  if (source === 'pos' || source === 'pos_sale') return HSN_CATEGORY_MAP.pos;
  return HSN_FALLBACK;
}
