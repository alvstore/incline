export interface InsightAuthorStore {
  ownerIds(): Promise<string[]>;
  accountExists(id: string): Promise<boolean>;
}

/** Internal single-branch and scheduled calls share the same real-account attribution. */
export async function resolveInsightAuthor(
  caller: { internal: boolean; userId: string | null },
  store: InsightAuthorStore,
): Promise<string> {
  if (!caller.internal) {
    if (!caller.userId) throw new Error('insight_author_missing: signed-in account required');
    return caller.userId; // requireCaller already verified this account with auth.getUser.
  }
  for (const id of await store.ownerIds()) {
    if (await store.accountExists(id)) return id;
  }
  throw new Error('insight_author_missing: configure a valid owner account before generating insights');
}