import { expect, test } from 'bun:test';
import { AUTOMATION_WORKER_TIMEOUT_MS, NURTURE_BATCH_LIMIT, requestAutomationWorker } from '../../supabase/functions/_shared/automationWorkerRequest';

test('workers have a 90-second response allowance and nurture caps AI candidates at five', () => {
  expect(AUTOMATION_WORKER_TIMEOUT_MS).toBe(90_000);
  expect(NURTURE_BATCH_LIMIT).toBe(5);
});
test('an ambiguous timeout reports unknown transport without duplicate dispatch', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  };
  try {
    const result = await requestAutomationWorker('https://example.invalid', {}, 5);
    expect(result.transport).toBe('timeout');
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  } finally { globalThis.fetch = original; }
});