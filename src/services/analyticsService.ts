import { supabase } from '@/integrations/supabase/client';

export type RevenueGrain = 'day' | 'week' | 'month';

export interface RevenueSeriesRow {
  period: string;       // ISO date (IST-bucketed)
  gross: number;
  refunds: number;
  reversals: number;
  net: number;
  txn_count: number;
}

export interface SessionDurationRow {
  day: string;            // ISO date (IST-bucketed)
  avg_minutes: number | null;
  member_days: number;
  sessions_total: number;
  sessions_auto: number;
}

export interface RevenueByPlanRow {
  plan_name: string;
  revenue: number;
  txn_count: number;
}

export const analyticsService = {
  async revenueSeries(opts: {
    branchId?: string | null;
    from: string;          // YYYY-MM-DD
    to: string;            // YYYY-MM-DD
    grain: RevenueGrain;
  }): Promise<RevenueSeriesRow[]> {
    const { data, error } = await supabase.rpc('analytics_revenue_series', {
      p_branch: opts.branchId || null,
      p_from: opts.from,
      p_to: opts.to,
      p_grain: opts.grain,
    });
    if (error) throw error;
    return (data || []) as RevenueSeriesRow[];
  },

  async revenueByPlan(opts: {
    branchId?: string | null;
    from: string;
    to: string;
    limit?: number;
  }): Promise<RevenueByPlanRow[]> {
    const { data, error } = await supabase.rpc('analytics_revenue_by_plan', {
      p_branch: opts.branchId || null,
      p_from: opts.from,
      p_to: opts.to,
      p_limit: opts.limit ?? 5,
    });
    if (error) throw error;
    return (data || []) as RevenueByPlanRow[];
  },

  async sessionDurationDaily(opts: {
    branchId?: string | null;
    days: number;
  }): Promise<SessionDurationRow[]> {
    const { data, error } = await supabase.rpc('analytics_session_duration_daily', {
      p_branch: opts.branchId || null,
      p_days: opts.days,
    });
    if (error) throw error;
    return (data || []) as SessionDurationRow[];
  },
};
