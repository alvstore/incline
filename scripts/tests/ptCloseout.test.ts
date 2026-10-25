import { describe, expect, it } from 'bun:test';
import { closeoutCommission, ptCloseoutError, ptCloseoutFormSchema } from '../../src/lib/invoices/ptCloseout';

describe('PT cash closeout', () => {
  it('Surendra retains 15000 with 7500 commission already shared', () => {
    expect(closeoutCommission(15000, 50, 0, 7500)).toEqual({ entitlement: 7500, remaining: 0 });
    expect(60000 - 15000).toBe(45000);
  });
  it('Ravi retains 10000 with 5000 commission already shared', () => {
    expect(closeoutCommission(10000, 50, 0, 5000)).toEqual({ entitlement: 5000, remaining: 0 });
    expect(37500 - 10000).toBe(27500);
  });
  it('Vishal retains 10000 with 5000 commission already shared', () => {
    expect(closeoutCommission(10000, 50, 0, 5000)).toEqual({ entitlement: 5000, remaining: 0 });
    expect(36000 - 10000).toBe(26000);
  });
  it('never re-pays linked payroll', () => {
    expect(closeoutCommission(10000, 50, 3000, 1000).remaining).toBe(1000);
  });
  it('overpaid commissions require recovery review', () => {
    expect(closeoutCommission(10000, 50, 6000, 0).remaining).toBeLessThan(0);
  });
  it('rejects negative external payments and missing reason', () => {
    expect(ptCloseoutFormSchema.safeParse({ reason: '', externalCommission: -1 }).success).toBe(false);
  });
  it('does not expose unexpected database details', () => {
    expect(ptCloseoutError({ message: 'private internal detail' })).not.toContain('private internal detail');
  });
});