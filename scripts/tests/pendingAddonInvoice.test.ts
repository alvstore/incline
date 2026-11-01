import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
// Deliberately nonexistent facility: validates payment handling without creating any bill.
test('pending is accepted as invoice-only instead of rejected as a payment method', async () => {
  const env = readFileSync('.env', 'utf8');
  const value = (name: string) => env.match(new RegExp(`^${name}=["']?([^"'\\n]+)`, 'm'))?.[1];
  const url = value('VITE_SUPABASE_URL');
  const key = value('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) throw new Error('Missing project configuration');
  const minted = JSON.parse(readFileSync(`${homedir()}/.cache/lovable-auth/session.json`, 'utf8'));
  const id = '00000000-0000-0000-0000-000000000000';
  const response = await fetch(`${url}/rest/v1/rpc/purchase_custom_benefit_credits`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${minted.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_member_id: id, p_membership_id: id, p_branch_id: id,
      p_benefit_type_id: id, p_quantity: 6, p_amount: 7000, p_payment_method: 'pending' }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: false, error: 'Facility not found' });
});