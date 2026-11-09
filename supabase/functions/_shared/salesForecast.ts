// v1.0.0 — Pure month-end sales projection used by ai-dashboard-insights.
export interface ForecastStats {
  days_elapsed: number;
  days_in_month: number;
  collected_mtd: number;
  avg_membership_value: number;
  renewal: { this_month_due: number; this_month_renewed: number; last_month_due: number; last_month_renewed: number; remaining_due: number };
}

export interface Projection {
  renewal_ratio: number;          // 0..1 blended
  daily_pace: number;
  expected_renewals: number;      // ₹
  low: number; likely: number; high: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * likely = collected + 60% of run-rate for remaining days + expected renewals.
 * The run-rate is discounted because part of it is already renewal money.
 * low   = collected + 40% run-rate + 70% expected renewals
 * high  = collected + 100% run-rate + expected renewals
 */
export function projectMonth(s: ForecastStats): Projection {
  const due = s.renewal.this_month_due + s.renewal.last_month_due;
  const renewed = s.renewal.this_month_renewed + s.renewal.last_month_renewed;
  const ratio = due > 0 ? renewed / due : 0;
  const elapsed = Math.max(1, s.days_elapsed);
  const remaining = Math.max(0, s.days_in_month - s.days_elapsed);
  const pace = s.collected_mtd / elapsed;
  const runRate = pace * remaining;
  const expected = s.renewal.remaining_due * ratio * s.avg_membership_value;
  return {
    renewal_ratio: r2(ratio),
    daily_pace: r2(pace),
    expected_renewals: r2(expected),
    low: r2(s.collected_mtd + 0.4 * runRate + 0.7 * expected),
    likely: r2(s.collected_mtd + 0.6 * runRate + expected),
    high: r2(s.collected_mtd + runRate + expected),
  };
}
