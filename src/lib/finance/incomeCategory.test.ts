// @ts-expect-error bun types
import { expect, test } from 'bun:test';
import { inferIncomeCategory } from './incomeCategory';
test('hand-picked category wins', () => expect(inferIncomeCategory({ income_category: { name: 'Class Fees' }, invoice: { invoice_items: [{ reference_type: 'membership' }] } })).toBe('Class Fees'));
test('membership invoice', () => expect(inferIncomeCategory({ invoice: { invoice_items: [{ reference_type: 'membership' }] } })).toBe('Membership Fees'));
test('pt invoice', () => expect(inferIncomeCategory({ invoice: { invoice_items: [{ reference_type: 'pt_package' }] } })).toBe('PT Packages'));
test('pos sale', () => expect(inferIncomeCategory({ invoice: { pos_sale_id: 'x' } })).toBe('Store / POS Sales'));
test('unknown', () => expect(inferIncomeCategory({})).toBe('Other Income'));
