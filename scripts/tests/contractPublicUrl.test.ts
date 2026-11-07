import { expect, test } from 'bun:test';
import { contractPublicOrigin } from '../../supabase/functions/contract-signing/publicUrl';

test('local testing still produces a usable public contract link', () => {
  expect(contractPublicOrigin(undefined, 'http://localhost:8080')).toBe('https://theincline.in');
  expect(contractPublicOrigin('http://localhost:8080', null)).toBe('https://theincline.in');
});
test('server configuration dynamically supports domain changes and strips paths', () => {
  expect(contractPublicOrigin('https://contracts.example.com/path/', 'https://theincline.in')).toBe('https://contracts.example.com');
});
test('published domain is used without configuration', () => {
  expect(contractPublicOrigin(undefined, 'https://www.theincline.in')).toBe('https://www.theincline.in');
});
test('preview, private, malformed and attacker origins cannot enter signing messages', () => {
  for (const origin of ['https://id-preview--example.lovable.app', 'https://evil.example', 'http://127.0.0.1:8080', 'https://192.168.1.5', 'https://localhost', 'not-a-url', 'https://user:password@theincline.in']) {
    expect(contractPublicOrigin(undefined, origin)).toBe('https://theincline.in');
  }
});