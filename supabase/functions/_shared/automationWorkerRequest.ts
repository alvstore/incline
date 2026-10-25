export const AUTOMATION_WORKER_TIMEOUT_MS = 90_000;
export const NURTURE_BATCH_LIMIT = 5;
export const NURTURE_START_BUDGET_MS = 60_000;

/** The timer covers response headers AND body. An abort is never retried here. */
export async function requestAutomationWorker(url: string, init: RequestInit, timeoutMs = AUTOMATION_WORKER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body: body.slice(0, 500), gateway5xx: [502, 503, 504].includes(response.status) };
  } catch (error) {
    return { ok: false, status: 0, body: error instanceof Error ? error.message : String(error), gateway5xx: false, transport: controller.signal.aborted ? 'timeout' as const : 'network' as const };
  } finally {
    clearTimeout(timer);
  }
}