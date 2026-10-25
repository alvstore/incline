/** Clamp a value into a 0–100 percentage of `max`. Null/invalid → 0. */
export function gaugePercent(value: number | null | undefined, max = 100): number {
  if (value == null || !Number.isFinite(value) || max <= 0) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export type GaugeTone = 'success' | 'warning' | 'destructive' | 'muted';

/** Score band used for 0–100 health/posture scores. */
export function scoreTone(score: number | null | undefined): GaugeTone {
  if (score == null || !Number.isFinite(score)) return 'muted';
  if (score >= 75) return 'success';
  if (score >= 50) return 'warning';
  return 'destructive';
}

export function scoreLabel(score: number | null | undefined): string {
  const t = scoreTone(score);
  return t === 'success' ? 'Good' : t === 'warning' ? 'Fair' : t === 'destructive' ? 'Needs work' : 'No scan';
}
