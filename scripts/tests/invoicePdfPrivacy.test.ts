import { describe, expect, it, mock } from 'bun:test';

mock.module('../../src/integrations/supabase/client', () => ({ supabase: {} }));
const { toInvoicePdfInput } = await import('../../src/utils/invoicePdfInput');

describe('customer invoice privacy', () => {
  it('never passes internal invoice notes to customer document builders', () => {
    const result = toInvoicePdfInput({
      invoice_number: 'QA-PRIVACY', created_at: '2026-10-25', status: 'paid',
      subtotal: 15000, total_amount: 15000, amount_paid: 15000,
      notes: 'PRIVATE_ADMIN_NOTE: owner settlement and internal audit',
      invoice_items: [],
    });
    expect(Object.hasOwn(result, 'notes')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ADMIN_NOTE');
    expect(result.total_amount).toBe(15000);
    expect(result.amount_paid).toBe(15000);
  });
  it('carries saved customer and branch postal fields into the document', () => {
    const result = toInvoicePdfInput({
      invoice_number: 'QA-ADDRESS', created_at: '2026-10-25', status: 'pending',
      total_amount: 1000, invoice_items: [],
      members: { profiles: { full_name: 'QA', address: 'Test Street', city: 'Udaipur', postal_code: '313001' } },
      branch: { name: 'INCLINE', address: 'Sector 14', city: 'Udaipur', state: 'Rajasthan', postal_code: '313001' },
    });
    expect(result.member_address).toBe('Test Street, Udaipur, 313001');
    expect(result.branch_address).toBe('Sector 14, Udaipur, Rajasthan, 313001');
  });
});