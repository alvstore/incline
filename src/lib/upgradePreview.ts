/** Select a bounded, deadline-first preview without mutating cached query results. */
export function selectUpgradePreview<T extends { id: string; window_ends_at: string }>(offers: readonly T[], now: Date): T[] {
  return offers.filter(offer => Date.parse(offer.window_ends_at) > now.getTime())
    .sort((a, b) => Date.parse(a.window_ends_at) - Date.parse(b.window_ends_at) || a.id.localeCompare(b.id))
    .slice(0, 3);
}