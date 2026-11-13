// @ts-expect-error bun test runtime
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { browserPushPresentation } from '../../../supabase/functions/_shared/browserPushPresentation';

describe('browser push privacy and destinations', () => {
  test('raw personal or financial inbox details never enter browser payloads', () => {
    const result = browserPushPresentation({ category: 'payment', title: 'Noor paid ₹15,000' }, true, false);
    expect(JSON.stringify(result)).not.toContain('Noor');
    expect(JSON.stringify(result)).not.toContain('15,000');
    expect(result.url).toBe('/invoices');
  });
  test('late check-in opens attendance and overdue tasks open tasks', () => {
    expect(browserPushPresentation({ category: 'staff_late' }, true, false).url).toBe('/attendance-dashboard');
    expect(browserPushPresentation({ category: 'task_overdue' }, true, false).url).toBe('/tasks');
  });
  test('non-team accounts do not get team destinations', () => {
    expect(browserPushPresentation({ category: 'staff_late' }, false, true).url).toBe('/member-dashboard');
    expect(browserPushPresentation({ category: 'staff_late' }, false, false).url).toBe('/trainer-dashboard');
  });
  test('external and backslash URLs cannot replace the safe destination', () => {
    for (const action_url of ['https://example.com', '//example.com', '/\\example.com']) {
      expect(browserPushPresentation({ category: 'payment', action_url }, true, false).url).toBe('/invoices');
    }
    expect(browserPushPresentation({ action_url: '/tasks?id=123' }, true, false).url).toBe('/tasks?id=123');
  });
});

test('push worker passes event payload and destination to the browser notification API', async () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  let displayed: { title: string; options: { body: string; data: { url: string } } } | undefined;
  let completion: Promise<unknown> | undefined;
  const self = {
    addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; },
    registration: { showNotification: async (title: string, options: { body: string; data: { url: string } }) => { displayed = { title, options }; } },
  };
  runInNewContext(readFileSync('public/push-sw.js', 'utf8'), { self, URL });
  const payload = browserPushPresentation({ category: 'staff_late' }, true, false);
  handlers.push({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => { completion = p; } });
  await completion;
  expect(displayed?.title).toBe(payload.title);
  expect(displayed?.options.body).toBe(payload.body);
  expect(displayed?.options.data.url).toBe('/attendance-dashboard');
});