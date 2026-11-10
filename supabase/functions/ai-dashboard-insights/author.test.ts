import { resolveInsightAuthor, type InsightAuthorStore } from './author.ts';

const OWNER = '3ede17c4-2955-4479-9c75-3cc890112ade';
const CALLER = '57bc0a36-8f53-420f-a750-b95fa0d23b2c';
function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
}
const store: InsightAuthorStore = {
  ownerIds: () => Promise.resolve([OWNER]),
  accountExists: (id) => Promise.resolve(id === OWNER),
};
Deno.test('signed-in insight uses the verified caller, not the owner', async () => {
  assertEqual(await resolveInsightAuthor({ internal: false, userId: CALLER }, store), CALLER);
});
for (const mode of ['single-branch', 'all-branches']) {
  Deno.test(`internal ${mode} insight uses a real owner, never the zero UUID`, async () => {
    assertEqual(await resolveInsightAuthor({ internal: true, userId: null }, store), OWNER);
  });
}
Deno.test('stale owner is skipped in favour of a real account', async () => {
  assertEqual(await resolveInsightAuthor({ internal: true, userId: null }, {
    ...store, ownerIds: () => Promise.resolve([CALLER, OWNER]),
  }), OWNER);
});
for (const ids of [[], [CALLER]]) {
  Deno.test(`missing or invalid owner fails explicitly (${ids.length} candidates)`, async () => {
    let failed = false;
    try {
      await resolveInsightAuthor({ internal: true, userId: null }, {
        ...store, ownerIds: () => Promise.resolve(ids),
      });
    } catch (e) {
      failed = e instanceof Error && e.message.startsWith('insight_author_missing:');
    }
    assertEqual(failed, true);
  });
}