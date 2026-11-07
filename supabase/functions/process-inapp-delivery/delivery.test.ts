import { deliverBatch, type DeliveryBatch } from './delivery.ts';
const batch: DeliveryBatch = { announcement_id: 'post-1', branch_id: 'branch-1', claim_token: 'claim', title: 'Notice', message: 'Festive hours', users: ['selected-user'] };
const assert = (value: boolean) => { if (!value) throw new Error('Assertion failed'); };
Deno.test('only selected users receive the In-App payload', async () => {
  const calls: Record<string, unknown>[] = [];
  const results = await deliverBatch(batch, async (input) => { calls.push(input); return { status: 'sent' }; });
  assert(calls.length === 1 && calls[0].user_id === 'selected-user' && calls[0].channel === 'in_app');
  assert(results[0].status === 'sent');
});
Deno.test('retry keeps identical dedupe key', async () => {
  const keys: unknown[] = [];
  for (let i = 0; i < 2; i++) await deliverBatch(batch, async (input) => { keys.push(input.dedupe_key); return { status: 'deduped' }; });
  assert(keys[0] === 'announcement:post-1:selected-user:in_app' && keys[0] === keys[1]);
});
Deno.test('failed payload is not counted as sent', async () => {
  const results = await deliverBatch(batch, async () => ({ status: 'failed' }));
  assert(results[0].status === 'failed');
});
Deno.test('network interruption remains unknown, not successful', async () => {
  const results = await deliverBatch(batch, async () => { throw new Error('network'); });
  assert(results[0].status === 'unknown');
});