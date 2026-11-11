import { describe, expect, test } from 'bun:test';
import { PROVIDER_DEFAULTS } from './providerCatalog';

describe('Lovable AI credential routing', () => {
  test('built-in AI uses the managed Lovable credential and gateway', () => {
    expect(PROVIDER_DEFAULTS.lovable.secret_name).toBe('LOVABLE_API_KEY');
    expect(new URL(PROVIDER_DEFAULTS.lovable.base_url).hostname).toBe('ai.gateway.lovable.dev');
  });

  test('provider presets cannot restore the retired Google key dependency', () => {
    expect(PROVIDER_DEFAULTS.google).toBeUndefined();
    expect(Object.values(PROVIDER_DEFAULTS).some(p => p.secret_name === 'GOOGLE_AI_API_KEY')).toBe(false);
  });
});