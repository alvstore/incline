import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle } from 'lucide-react';

/**
 * Shows the top 3 failure reasons for a campaign so operators can tell
 * "247 × paced_131049" (a rate problem) from "275 × Failed to send a
 * request to the Edge Function" (an infrastructure bug) at a glance.
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
        .select('error')
        .eq('campaign_id', campaignId)
        .eq('status', 'failed')
        .not('error', 'is', null)
        .limit(1000);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const raw = String((row as { error: string | null }).error || '').trim();
        if (!raw) continue;
        // Group by leading pace/meta code when present; otherwise first 80 chars.
        const meta = raw.match(/\b(13\d{4})\b/);
        const key = meta ? `meta_${meta[1]}` : raw.slice(0, 80);
        counts[key] = (counts[key] || 0) + 1;
      }
      return Object.entries(counts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);
    },
    enabled: !!campaignId,
    refetchInterval: active ? 8000 : false,
    staleTime: 5000,
  });

  if (!data || data.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg bg-destructive/5 border border-destructive/20 px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-destructive font-semibold mb-1.5">
        <AlertTriangle className="h-3 w-3" />
        Top failure reasons
      </div>
      <ul className="space-y-1">
        {data.map(([reason, count]) => (
          <li
            key={reason}
            className="flex items-start justify-between gap-2 text-[11px] text-foreground/80"
          >
            <span className="truncate font-mono" title={reason}>
              {reason}
            </span>
            <span className="shrink-0 tabular-nums font-medium text-destructive">
              × {count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
