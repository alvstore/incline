import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface HistoryRow {
  nurture_angle_history: Array<{ angle: string | null; sent_at: string; fallback?: boolean }> | null;
}

export function NurtureVarietyCard() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('whatsapp_chat_settings')
        .select('nurture_angle_history')
        .not('last_nurture_at', 'is', null)
        .order('last_nurture_at', { ascending: false })
        .limit(200);
      if (!cancelled) {
        setRows((data as HistoryRow[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
    const counts = new Map<string, number>();
    let total = 0;
    let fallback = 0;
    for (const r of rows) {
      const hist = Array.isArray(r.nurture_angle_history) ? r.nurture_angle_history : [];
      for (const e of hist) {
        if (!e?.sent_at) continue;
        if (new Date(e.sent_at).getTime() < cutoff) continue;
        const key = e.angle || 'unknown';
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total++;
        if (e.fallback) fallback++;
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { sorted, total, fallback };
  }, [rows]);

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-indigo-600" />
          Nurture variety (last 7 days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : stats.total === 0 ? (
          <p className="text-sm text-slate-500">No nurture sends yet in the last 7 days.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-slate-600">{stats.total} sends</span>
              <Badge variant={stats.fallback / stats.total > 0.3 ? 'destructive' : 'secondary'}>
                {stats.fallback} fallbacks
              </Badge>
              <Badge variant={stats.sorted.length < 3 ? 'destructive' : 'secondary'}>
                {stats.sorted.length} distinct angles
              </Badge>
            </div>
            <div className="space-y-1">
              {stats.sorted.map(([angle, n]) => {
                const pct = Math.round((n / stats.total) * 100);
                return (
                  <div key={angle} className="flex items-center gap-2 text-sm">
                    <span className="w-40 truncate text-slate-700">{angle}</span>
                    <div className="h-2 flex-1 rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-indigo-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-xs text-slate-500">{n} · {pct}%</span>
                  </div>
                );
              })}
            </div>
            {stats.sorted.length < 3 && (
              <p className="text-xs text-amber-700">
                Variety is low — check that <code>lead_nurture_angles</code> has multiple active rows.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
