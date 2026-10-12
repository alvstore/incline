/**
 * Product analytics wrapper. Event names are `object_action` snake_case.
 * Never pass names, phone numbers, emails or per-person amounts.
 *
 * | Event               | When                                  |
 * |---------------------|---------------------------------------|
 * | pt_renew_opened     | Renew opens the PT purchase drawer    |
 * | pt_renew_completed  | Server confirmed the renewal purchase |
 */
type Props = Record<string, string | number | boolean | null>;
export function track(event: string, properties?: Props) {
  if (import.meta.env.DEV) { console.debug('[analytics]', event, properties ?? {}); return; }
  const w = window as unknown as { posthog?: { capture: (e: string, p?: Props) => void } };
  w.posthog?.capture(event, properties);
}
