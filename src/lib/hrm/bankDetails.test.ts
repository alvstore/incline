// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { maskAccount, isValidIfsc, isValidAccount } from './bankDetails';

describe('bank details', () => {
  it('masks all but last four digits', () => {
    expect(maskAccount('123456789012')).toBe('•••• 9012');
    expect(maskAccount('')).toBe('—');
  });
  it('validates IFSC format', () => {
    expect(isValidIfsc('HDFC0001234')).toBe(true);
    expect(isValidIfsc('HDFC1001234')).toBe(false);
  });
  it('validates account digits 6-24', () => {
    expect(isValidAccount('12345')).toBe(false);
    expect(isValidAccount('123456')).toBe(true);
  });
});
