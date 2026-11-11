// @ts-expect-error -- bun's built-in test runner has no types in the app build
import { describe, it, expect } from 'bun:test';
import { isAllowedOrigin } from './originAllowlist';
describe('CSP allowlist', () => {
  it('allows backend, Razorpay and own site', () => {
    expect(isAllowedOrigin('https://iyqqpbvnszyrrgerniog.supabase.co', 'https://theincline.in')).toBe(true);
    expect(isAllowedOrigin('https://checkout.razorpay.com', 'https://theincline.in')).toBe(true);
    expect(isAllowedOrigin('https://www.theincline.in', 'https://theincline.in')).toBe(true);
  });
  it('flags unknown origins', () => {
    expect(isAllowedOrigin('https://evil.example.com', 'https://theincline.in')).toBe(false);
  });
});
