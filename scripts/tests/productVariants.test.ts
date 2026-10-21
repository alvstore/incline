import { describe, expect, test } from 'bun:test';
import { emptyVariant, groupVariants, priceRange, suggestSku, validateVariants, variantName } from '../../src/lib/products/variantRules';

const v = (value: string, price = '999', sku = '') => ({ ...emptyVariant(), value, price, sku });

describe('product options', () => {
  test('each option gets its own name and SKU', () => {
    expect(variantName('Whey Protein', 'Chocolate')).toBe('Whey Protein — Chocolate');
    expect(suggestSku('wp', 'Cafe Mocha')).toBe('WP-CAFE-MOCHA');
  });
  test('needs at least two options', () => {
    expect(validateVariants([v('Chocolate')], true)).not.toBeNull();
  });
  test('duplicate option names and SKUs are rejected', () => {
    expect(validateVariants([v('Choco'), v('choco')], true)).toContain('twice');
    expect(validateVariants([v('A', '9', 'X1'), v('B', '9', 'x1')], true)).toContain('SKU');
  });
  test('options sold on POS need a price above ₹0', () => {
    expect(validateVariants([v('A', '0'), v('B')], true)).toContain('price');
    expect(validateVariants([v('A', '0'), v('B', '0')], false)).toBeNull();
  });
  test('price range and grouping', () => {
    expect(priceRange([999, 1499])).toBe('₹999 – ₹1,499');
    expect(priceRange([999, 999])).toBe('₹999');
    const g = groupVariants([{ id: 'a', parent_product_id: 'P' }, { id: 'b', parent_product_id: 'P' }, { id: 'c', parent_product_id: null }]);
    expect(g.length).toBe(2);
    expect(g[0].items.length).toBe(2);
    expect(g[1].isGroup).toBe(false);
  });
});
