import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, Gauge } from 'lucide-react';
import { explainCommError, isPacingError } from '@/lib/comms/metaErrorLabels';

type Group = { key: string; count: number; sample: string };

/**
 * Shows why a campaign under-delivered, split into two very different things:
 *  - Pace limited — Meta withheld marketing messages (131049 / 130472). Not a failure.
 *  - Real failures — grouped by Meta code with an operator-facing explanation.
 * Read-only aggregation over `campaign_recipients.error`.
 */
export function CampaignFailureBreakdown({
  campaignId,
  active,
}: {
  campaignId: string;
  active: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['campaign-failure-breakdown', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_recipients')
        .select('error, status')
        .eq('campaign_id', campaignId)
        .in('status', ['failed', 'pace_limited'])
        .not('error', 'is', null)
        .limit(1000);
      if (error) throw error;

      let paced = 0;
      const counts: Record<string, { count: number; sample: string }> = {};
      for (const row of data || []) {
        const raw = String((row as { error: string | null }).error || '').trim();
        const status = String((row as { status: string | null }).status || '');
        if (!raw && status !== 'pace_limited') continue;
        if (status === 'pace_limited' || isPacingError(raw)) {
          paced++;
          continue;
        }
        const explained = explainCommError(raw);
        const key = explained.title;
        counts[key] = { count: (counts[key]?.count || 0) + 1, sample: raw };
      }
      const reasons: Group[] = Object.entries(counts)
        .sort(([, a], [, b]) => b.count - a.count)
        .slice(0, 3)
        .map(([key, v]) => ({ key, count: v.count, sample: v.sample }));
      return { paced, reasons };
    },
    enabled: !!campaignId,
    refetchInterval: active ? 8000 : false,
    staleTime: 5000,
  });

  if (!data || (data.paced === 0 && data.reasons.length === 0)) return null;

  return (
    <div className="mb-3 space-y-2">
      {data.paced > 0 && (
        <div className="rounded-lg bg-warning/10 border border-warning/25 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-warning font-semibold">
              <Gauge className="h-3 w-3" />
              Pace limited
            </span>
            <span className="shrink-0 tabular-nums text-[11px] font-medium text-warning">
              × {data.paced}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-foreground/70">
            Meta withheld these marketing messages to protect recipient experience — not a delivery
            failure. Retry is disabled; they become eligible again after the cooldown.
          </p>
        </div>
      )}

      {data.reasons.length > 0 && (
        <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-destructive font-semibold mb-1.5">
            <AlertTriangle className="h-3 w-3" />
            Top failure reasons
          </div>
          <ul className="space-y-1.5">
            {data.reasons.map((r) => {
              const explained = explainCommError(r.sample);
              return (
                <li key={r.key} className="text-[11px] text-foreground/80">
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate font-medium" title={r.sample}>
                      {r.key}
                    </span>
                    <span className="shrink-0 tabular-nums font-medium text-destructive">
                      × {r.count}
                    </span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    {explained.what} {explained.action}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
