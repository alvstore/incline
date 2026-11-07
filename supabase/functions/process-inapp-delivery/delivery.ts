// Pure delivery orchestration; providers and persistence are injected for mock tests.
export interface DeliveryBatch {
  announcement_id: string;
  branch_id: string;
  claim_token: string;
  title: string;
  message: string;
  users: string[];
}
export interface DeliveryResult { user_id: string; status: string; error?: string }
export async function deliverBatch(batch: DeliveryBatch, dispatch: (input: Record<string, unknown>) => Promise<{ status?: string }>): Promise<DeliveryResult[]> {
  return Promise.all(batch.users.map(async (user_id) => {
    try {
      const result = await dispatch({
        branch_id: batch.branch_id, channel: 'in_app', category: 'announcement',
        user_id, recipient: user_id, ttl_seconds: 315360000,
        payload: { subject: batch.title, body: batch.message },
        dedupe_key: `announcement:${batch.announcement_id}:${user_id}:in_app`,
      });
      return { user_id, status: result.status ?? 'failed' };
    } catch {
      // An interrupted request may have succeeded; the next claim uses the same key.
      return { user_id, status: 'unknown', error: 'Dispatcher outcome unknown' };
    }
  }));
}