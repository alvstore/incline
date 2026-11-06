/** Pace as min:ss per km; '—' when distance is zero. */
export function formatPace(durationSeconds: number, distanceMeters: number): string {
  if (!distanceMeters || distanceMeters <= 0 || !durationSeconds) return '—';
  const secPerKm = Math.round(durationSeconds / (distanceMeters / 1000));
  const m = Math.floor(secPerKm / 60);
  const s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}
