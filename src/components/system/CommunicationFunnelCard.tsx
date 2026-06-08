import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Send, ShieldOff, Repeat2, Hourglass, AlertCircle, Loader2 } from 'lucide-react';

interface FunnelCounts {
  sent: number;
  failed: number;
  suppressed: number;
  deduped: number;
  queued: number;
}

async function fetchFunnel(): Promise<FunnelCounts> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('communication_logs')
    .select('delivery_status')
    .gte('created_at', since);
  if (error) throw error;
  const counts: FunnelCounts = { sent: 0, failed: 0, suppressed: 0, deduped: 0, queued: 0 };
  for (const row of data ?? []) {
    const s = (row as { delivery_status?: string }).delivery_status as keyof FunnelCounts | undefined;
    if (s && s in counts) counts[s] += 1;
  }
  return counts;
}

const TILES: Array<{
  key: keyof FunnelCounts;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  hint: string;
}> = [
  { key: 'sent',       label: 'Sent (24h)',       icon: Send,        color: 'text-success', hint: 'Successfully delivered to a provider' },
  { key: 'queued',     label: 'Queued',           icon: Hourglass,   color: 'text-info',    hint: 'Deferred for member quiet hours' },
  { key: 'deduped',    label: 'Deduped',          icon: Repeat2,     color: 'text-primary',  hint: 'Blocked by dedupe key — replay/retry' },
  { key: 'suppressed', label: 'Suppressed',       icon: ShieldOff,   color: 'text-warning',   hint: 'Blocked by member preference' },
  { key: 'failed',     label: 'Failed',           icon: AlertCircle, color: 'text-destructive',    hint: 'Provider error — see communication_logs.error_message' },
];

export function CommunicationFunnelCard() {
  const { data, isLoading } = useQuery({ queryKey: ['comm-funnel-24h'], queryFn: fetchFunnel });

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg shadow/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          Communication Funnel — last 24h
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {TILES.map((t) => (
              <div key={t.key} className="rounded-xl bg-muted p-3" title={t.hint}>
                <div className="flex items-center gap-2">
                  <t.icon className={`h-4 w-4 ${t.color}`} />
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t.label}</p>
                </div>
                <p className="text-2xl font-bold text-foreground mt-1">{data?.[t.key] ?? 0}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
