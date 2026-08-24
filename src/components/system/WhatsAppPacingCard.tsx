import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ShieldAlert, ShieldCheck, Gauge } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface HealthRow {
  phone_number_id: string;
  breaker_open_until: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
}

interface SuppressedRow {
  error_message: string | null;
}

const isOpen = (row: HealthRow) =>
  !!row.breaker_open_until && new Date(row.breaker_open_until).getTime() > Date.now();

/**
 * Surfaces the WhatsApp pacing circuit breaker and the reasons the dispatcher
 * suppressed sends in the last 24h (send budget, pacing cooldown, breaker).
 */
export function WhatsAppPacingCard() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['whatsapp-pacing-health'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [health, suppressed] = await Promise.all([
        supabase
          .from('whatsapp_health')
          .select('phone_number_id, breaker_open_until, last_error_at, last_error_code'),
        supabase
          .from('communication_logs')
          .select('error_message')
          .eq('delivery_status', 'suppressed')
          .gte('created_at', since)
          .limit(1000),
      ]);
      if (health.error) throw health.error;
      if (suppressed.error) throw suppressed.error;

      const reasons = new Map<string, number>();
      for (const row of (suppressed.data ?? []) as SuppressedRow[]) {
        const key = (row.error_message ?? 'unknown').split(':')[0].trim() || 'unknown';
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
      }
      return {
        health: (health.data ?? []) as HealthRow[],
        total: suppressed.data?.length ?? 0,
        reasons: Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
      };
    },
  });

  const openBreakers = (data?.health ?? []).filter(isOpen);

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-5 w-5 text-primary" />
          WhatsApp Pacing &amp; Suppression
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">Could not load pacing health.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {openBreakers.length === 0 ? (
                <Badge className="rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Breaker closed — sending normally
                </Badge>
              ) : (
                openBreakers.map((row) => (
                  <Badge
                    key={row.phone_number_id}
                    className="rounded-full bg-red-100 text-red-700 hover:bg-red-100"
                  >
                    <ShieldAlert className="mr-1 h-3.5 w-3.5" />
                    Paused ({row.last_error_code ?? 'pacing'}) ·{' '}
                    {formatDistanceToNow(new Date(row.breaker_open_until as string), {
                      addSuffix: true,
                    })}
                  </Badge>
                ))
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Suppressed in last 24h · {data?.total ?? 0}
              </p>
              {(data?.reasons.length ?? 0) === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing suppressed — every queued message was allowed through.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {data?.reasons.map(([reason, count]) => (
                    <li key={reason} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{reason}</span>
                      <span className="font-semibold text-foreground">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
