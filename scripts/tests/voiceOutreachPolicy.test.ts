import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const session = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON
  ? JSON.parse(process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON)
  : JSON.parse(readFileSync(`${homedir()}/.cache/lovable-auth/session.json`, 'utf8')).session;
const env = readFileSync('.env', 'utf8');
const value = (name: string) => env.match(new RegExp(`^${name}=["']?([^"'\\n]+)`, 'm'))?.[1];
const url = value('VITE_SUPABASE_URL');
const key = value('VITE_SUPABASE_PUBLISHABLE_KEY');
async function rpc(name: string, body: Record<string, unknown>) {
  if (!url || !key) throw new Error('Missing project configuration');
  const result = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: {
    apikey: key, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
  const data = await result.json();
  if (!result.ok) throw new Error(`Policy check failed: ${result.status}`);
  return data;
}
const now = '2026-10-17T06:00:00Z';
const decide = (attempts: number, last: string | null, stop: string | null, cooldown = 7) => rpc('voice_outreach_decision', {
  _attempts: attempts, _last_attempt: last, _stop: stop, _cooldown: cooldown, _now: now,
});
test('third attempt stops future calls even after cooldown', async () => {
  const r = await decide(3, '2026-09-01T06:00:00Z', null);
  expect(r.ok).toBe(false); expect(r.code).toBe('member_attempt_limit'); expect(r.next_attempt_at).toBeNull();
});
test('initial call plus only two follow-ups', async () => {
  const r = await decide(2, '2026-10-10T06:00:00Z', null);
  expect(r.ok).toBe(true); expect(r.max_calls).toBe(3); expect(r.max_followups).toBe(2);
});
test('caller cannot bypass seven-day follow-up gap', async () => {
  const r = await decide(1, '2026-10-16T06:00:00Z', null, 0);
  expect(r.ok).toBe(false); expect(r.cooldown_days).toBe(7); expect(r.code).toBe('cooldown_active');
});
test('decline stops further outreach regardless of cooldown', async () => {
  const r = await decide(1, '2026-09-01T06:00:00Z', 'declined');
  expect(r.ok).toBe(false); expect(r.code).toBe('outreach_declined'); expect(r.next_attempt_at).toBeNull();
});
test('relocation stays suppressed without another automatic call', async () => {
  const r = await rpc('voice_member_outreach_policy', { _member_id: '72ad5612-bb3b-442e-821f-6b3d0ff0ef3b' });
  expect(r.ok).toBe(false); expect(r.code).toBe('outreach_relocated'); expect(r.next_attempt_at).toBeNull();
});