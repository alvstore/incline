/** Infer an income category name when a payment has none picked by hand. */
export function inferIncomeCategory(p: {
  income_category?: { name?: string | null } | null;
  invoice?: { pos_sale_id?: string | null; invoice_items?: { reference_type?: string | null }[] | null } | null;
}): string {
  if (p.income_category?.name) return p.income_category.name;
  if (p.invoice?.pos_sale_id) return 'Store / POS Sales';
  const types = (p.invoice?.invoice_items || []).map((i) => (i.reference_type || '').toLowerCase());
  if (types.some((t) => t.includes('membership') || t.includes('upgrade'))) return 'Membership Fees';
  if (types.some((t) => t.includes('pt'))) return 'PT Packages';
  if (types.some((t) => t.includes('locker'))) return 'Locker Rental';
  if (types.some((t) => t.includes('product') || t.includes('pos'))) return 'Store / POS Sales';
  if (types.some((t) => t.includes('addon') || t.includes('add_on') || t.includes('benefit'))) return 'Add-on Services';
  return 'Other Income';
}
