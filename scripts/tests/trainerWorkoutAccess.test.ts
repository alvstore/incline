import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const session = JSON.parse(process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ?? '{}');
const env = readFileSync('.env', 'utf8');
const value = (name: string) => env.match(new RegExp(`^${name}=["']?([^"'\\n]+)`, 'm'))?.[1];
const url = value('VITE_SUPABASE_URL');
const key = value('VITE_SUPABASE_PUBLISHABLE_KEY');
async function request(path: string, body?: Record<string, unknown>, anonymous = false) {
  if (!url || !key || !session.access_token) throw new Error('Authenticated policy test configuration unavailable');
  return fetch(`${url}/rest/v1/${path}`, { method: body ? 'POST' : 'GET', headers: {
    apikey: key, Authorization: `Bearer ${anonymous ? key : session.access_token}`,
    'Content-Type': 'application/json',
  }, body: body ? JSON.stringify(body) : undefined });
}
test('trainer workout SELECT no longer fails on the internal helper', async () => {
  const response = await request('treadmill_workouts?select=id&limit=1');
  expect(response.status).toBe(200);
  expect(Array.isArray(await response.json())).toBe(true);
});
test('unknown client is refused by caller-bound RPC', async () => {
  const response = await request('rpc/trainer_can_read_member_runs', { p_member: '00000000-0000-0000-0000-000000000000' });
  expect(response.status).toBe(403);
});
test('private ownership helper remains unavailable to trainers', async () => {
  const response = await request('rpc/_trainer_owns_member', {
    p_user: session.user.id, p_member: '00000000-0000-0000-0000-000000000000',
  });
  expect(response.status).toBe(403);
});
test('anonymous users cannot execute the new helper', async () => {
  const response = await request('rpc/trainer_can_read_member_runs', { p_member: '00000000-0000-0000-0000-000000000000' }, true);
  expect(response.status).toBe(401);
});