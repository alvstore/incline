import { describe, it as test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDER_DEFAULTS } from './providerCatalog';

describe('Lovable AI credential routing', () => {
  test('built-in AI uses the managed Lovable credential and gateway', () => {
    assert.equal(PROVIDER_DEFAULTS.lovable.secret_name, 'LOVABLE_API_KEY');
    assert.equal(new URL(PROVIDER_DEFAULTS.lovable.base_url).hostname, 'ai.gateway.lovable.dev');
  });

  test('provider presets cannot restore the retired Google key dependency', () => {
    assert.equal(PROVIDER_DEFAULTS.google, undefined);
    assert.equal(Object.values(PROVIDER_DEFAULTS).some(p => p.secret_name === 'GOOGLE_AI_API_KEY'), false);
  });
});