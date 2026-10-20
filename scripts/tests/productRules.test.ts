import { describe, expect, test } from 'bun:test';
import { marginPercent, movementSign, posBlocker, posState, previewAdjustment, reasonsForMode, stockStatus } from '../../src/lib/products/productRules';

describe('stock adjustments', () => {
  test('add, remove and set exact count', () => {
    expect(previewAdjustment(2, 'add', 10)).toEqual({ next: 12, delta: 10 });
    expect(previewAdjustment(12, 'remove', 3)).toEqual({ next: 9, delta: -3 });
    expect(previewAdjustment(9, 'set', 4)).toEqual({ next: 4, delta: -5 });
  });
  test('cannot remove more than is in stock', () => {
    expect(previewAdjustment(2, 'remove', 3)).toEqual({ error: 'Only 2 in stock' });
  });
  test('set to zero is allowed, add zero is not', () => {
    expect(previewAdjustment(5, 'set', 0)).toEqual({ next: 0, delta: -5 });
    expect('error' in previewAdjustment(5, 'add', 0)).toBe(true);
  });
  test('damaged and expired are removal reasons only', () => {
    expect(reasonsForMode('add').some((r) => r.value === 'damaged')).toBe(false);
    expect(reasonsForMode('remove').some((r) => r.value === 'expired')).toBe(true);
  });
  test('sales and adjust-downs reduce stock', () => {
    expect(movementSign('sale')).toBe(-1);
    expect(movementSign('adjust_out')).toBe(-1);
    expect(movementSign('sale_return')).toBe(1);
  });
});

describe('POS readiness', () => {
  test('a product needs a selling price above ₹0 to go on POS', () => {
    expect(posBlocker({ price: 0, image_url: '/x.jpg' })).toBe('Set a selling price above ₹0');
    expect(posBlocker({ price: 999, image_url: '/x.jpg' })).toBeNull();
  });
  test('a product needs a photo (standard photo counts)', () => {
    expect(posBlocker({ price: 999, image_url: null })).not.toBeNull();
    expect(posState({ is_sellable: false, price: 999, image_url: '/images/store/product-default.jpg' })).toBe('hidden');
  });
  test('margin is blank at ₹0 price instead of -Infinity', () => {
    expect(marginPercent(0, 1809.92)).toBeNull();
    expect(marginPercent(1000, 750)).toBe(25);
  });
  test('stock status uses the reorder level', () => {
    expect(stockStatus(0, 5)).toBe('out');
    expect(stockStatus(2, 5)).toBe('low');
    expect(stockStatus(9, 5)).toBe('ok');
  });
});
