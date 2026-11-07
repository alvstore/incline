import { deliverBatch, processDeliveryQueue, type DeliveryBatch } from './delivery.ts';
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
Deno.test('no due claim sends nothing on future or repeated ticks', async () => {
  let sends = 0;
  const processed = await processDeliveryQueue({ claim: async () => null, dispatch: async () => { sends++; return { status: 'sent' }; }, finish: async () => {} });
  assert(processed === 0 && sends === 0);
});
Deno.test('due scheduled claim reaches dispatcher and saves results', async () => {
  let claim = true; let saved: unknown;
  const count = await processDeliveryQueue({ claim: async () => { if (!claim) return null; claim = false; return batch; }, dispatch: async () => ({ status: 'sent' }), finish: async (_, results) => { saved = results; } });
  assert(count === 1 && JSON.stringify(saved) === JSON.stringify([{ user_id: 'selected-user', status: 'sent' }]));
});
Deno.test('stale finish fails instead of counting a successful job', async () => {
  let failed = false;
  try { await processDeliveryQueue({ claim: async () => batch, dispatch: async () => ({ status: 'sent' }), finish: async () => { throw new Error('Stale claim'); } }); } catch { failed = true; }
  assert(failed);
});
Deno.test('bounded worker leaves large queues for the next tick', async () => {
  let claims = 0;
  const processed = await processDeliveryQueue({ claim: async () => { claims++; return batch; }, dispatch: async () => ({ status: 'sent' }), finish: async () => {} }, () => 0);
  assert(claims === 10 && processed === 10);
});