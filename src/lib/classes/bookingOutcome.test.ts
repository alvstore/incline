// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { bookingOutcome } from './bookingOutcome';

describe('bookingOutcome', () => {
  it('paid booking returns invoice', () => {
    expect(bookingOutcome({ success: true, code: 'booked', invoice_id: 'i1' })).toEqual({ kind: 'booked', invoiceId: 'i1' });
  });
  it('already booked is not an error', () => {
    expect(bookingOutcome({ success: true, already_booked: true }).kind).toBe('already_booked');
  });
  it('network error is unknown, not failed', () => {
    expect(bookingOutcome(null, new TypeError('Failed to fetch')).kind).toBe('unknown');
  });
  it('invoice failure is a definite failure', () => {
    expect(bookingOutcome(null, new Error('invoice_failed: could not create')).kind).toBe('failed');
  });
});
