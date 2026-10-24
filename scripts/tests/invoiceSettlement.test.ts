import { describe, expect, it } from 'bun:test';
import { invoiceCommunicationEvent, isSalaryDeduction } from '../../src/lib/invoices/settlementDisplay';

describe('store payroll settlement', () => {
  it('does not treat a paid-style salary deduction as money received', () => {
    const invoice = { status: 'paid', pos_sales: { settlement: 'salary_deduction' } };
    expect(isSalaryDeduction(invoice)).toBe(true);
    expect(invoiceCommunicationEvent(invoice)).toBe('invoice_generated');
  });
  it('keeps an ordinary paid sale as a payment receipt', () => {
    expect(invoiceCommunicationEvent({ status: 'paid', pos_sales: { settlement: 'paid' } })).toBe('payment_received');
  });
  it('does not label a cancelled purchase as a salary deduction', () => {
    expect(isSalaryDeduction({ status: 'cancelled', pos_sales: { settlement: 'salary_deduction' } })).toBe(false);
  });
});