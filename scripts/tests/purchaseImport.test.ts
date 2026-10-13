import { describe, expect, test } from 'bun:test';
import { canActivateProduct, parsePurchaseRows, splitGst } from '../../src/lib/purchases/parsePurchaseSheet';

const header = ['Invoice No', 'Invoice Date', 'Vendor Name', 'Vendor GSTIN', 'Item Name', 'HSN Code', 'Qty', 'Rate', 'Taxable Amount', 'CGST (2.5%)', 'SGST (2.5%)', 'Total Amount'];

describe('purchase import rules', () => {
  test('5% GST splits into 2.5% CGST + 2.5% SGST', () => {
    expect(splitGst(2000, 5)).toEqual({ cgst: 50, sgst: 50, total: 2100 });
  });
  test('rows group by bill number and infer 5% from header', () => {
    const { bills } = parsePurchaseRows([
      header,
      ['009', new Date(2026, 8, 12), 'Ganpati Nutrition', '08GJVPM7898N1ZI', 'RUN Protein coffee', '2106', 2, 1000, 2000, 50, 50, 2100],
      ['008', new Date(2026, 8, 12), 'Ganpati Nutrition', '08GJVPM7898N1ZI', 'Xtend BCAA', '2106', 2, 1476.19, 2952.38, 73.8, 73.8, 3099.99],
      [null, null, null, null, null, null, null, null, 4952.38, null, null, 5199.99],
    ]);
    expect(bills.length).toBe(2);
    expect(bills[0].lines[0].gst_rate).toBe(5);
    expect(bills[0].bill_date).toBe('2026-09-12');
  });
  test('product cannot be activated without photo and selling price', () => {
    expect(canActivateProduct({ image_url: null, price: 999 })).toBe(false);
    expect(canActivateProduct({ image_url: 'x.jpg', price: 0 })).toBe(false);
    expect(canActivateProduct({ image_url: 'x.jpg', price: 999 })).toBe(true);
  });
});
