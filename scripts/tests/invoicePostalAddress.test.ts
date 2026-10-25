import { describe, expect, it } from 'bun:test';
import { formatPostalAddress } from '../../src/lib/invoices/postalAddress';

describe('saved invoice addresses', () => {
  it('includes street, city, state and postal code', () => {
    expect(formatPostalAddress({ address: 'Sector 14', city: 'Udaipur', state: 'Rajasthan', postal_code: '313001' }))
      .toBe('Sector 14, Udaipur, Rajasthan, 313001');
  });
  it('does not invent a missing address', () => {
    expect(formatPostalAddress(null)).toBeNull();
    expect(formatPostalAddress({ address: ' ' })).toBeNull();
  });
  it('does not repeat location already in the street field', () => {
    expect(formatPostalAddress({ address: 'Sector 14, Udaipur', city: 'Udaipur', state: 'Rajasthan' }))
      .toBe('Sector 14, Udaipur, Rajasthan');
  });
});