/** Saved AI insights older than this are refreshed automatically when the dashboard opens. */
export const INSIGHTS_STALE_MS = 6 * 60 * 60 * 1000;

export function isInsightStale(generatedAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!generatedAt) return true;
  const t = new Date(generatedAt).getTime();
  if (Number.isNaN(t)) return true;
  return now - t >= INSIGHTS_STALE_MS;
}
