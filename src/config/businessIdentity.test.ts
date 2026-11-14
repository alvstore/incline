// @ts-expect-error bun test runtime types are not installed
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BUSINESS_IDENTITY, realOr } from './businessIdentity';

const files = ['index.html', 'public/ai.txt', 'public/llms-full.txt'];
describe('business identity stays consistent', () => {
  for (const f of files) {
    it(`${f} uses postcode 313002 and the GBP street`, () => {
      const s = readFileSync(f, 'utf8');
      expect(s).not.toContain('313001');
      expect(s).toContain(BUSINESS_IDENTITY.postalCode);
      expect(s).toContain('Plot 44-55, near Kheda Circle');
    });
  }
  it('replaces the Mumbai placeholder address', () => {
    expect(realOr('123 Fitness Street, Mumbai, India', 'X')).toBe('X');
    expect(realOr('+91 98765 43210', 'X')).toBe('X');
  });
});
