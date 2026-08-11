import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Sparkles, CheckCircle2, AlertCircle, ShieldAlert, ShieldX, Wand2 } from 'lucide-react';
import { AIGenerateTemplatesDrawer } from './AIGenerateTemplatesDrawer';
import { getEventsForChannel, type EventChannel } from '@/lib/templates/systemEvents';

type Channel = EventChannel;

type RowState = 'ok' | 'pending' | 'rejected' | 'inactive' | 'missing';

const STATE_META: Record<RowState, { label: string; icon: any; cls: string }> = {
  ok: { label: 'Ready', icon: CheckCircle2, cls: 'bg-success/10 text-success border-success/20' },
  pending: { label: 'Pending Approval', icon: ShieldAlert, cls: 'bg-warning/10 text-warning border-warning/20' },
  rejected: { label: 'Rejected', icon: ShieldX, cls: 'bg-destructive/10 text-destructive border-destructive/20' },
  inactive: { label: 'Inactive', icon: AlertCircle, cls: 'bg-muted text-muted-foreground' },
  missing: { label: 'Missing', icon: AlertCircle, cls: 'bg-destructive/10 text-destructive border-destructive/20' },
};

interface Props {
  channel: Channel;
}

export function TemplateCoverageMatrix({ channel }: Props) {
  const qc = useQueryClient();
  const { effectiveBranchId } = useBranchContext();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSeed, setAiSeed] = useState<string[] | undefined>(undefined);

  const { data, isLoading } = useQuery({
    queryKey: ['template-coverage', channel, effectiveBranchId],
    queryFn: async () => {
      const tplQ = supabase
        .from('templates')
        .select('id, name, type, trigger_event, is_active, meta_template_status, meta_template_name')
        .eq('type', channel);
      const triggersQ = channel === 'whatsapp'
        ? supabase
            .from('whatsapp_triggers')
            .select('event_name, is_active, template_id, templates(id, name, is_active, meta_template_status)')
            .eq('branch_id', effectiveBranchId!)
        : null;
      const [tplRes, trigRes] = await Promise.all([
        effectiveBranchId ? tplQ.eq('branch_id', effectiveBranchId) : tplQ,
        triggersQ,
      ]);
      if (tplRes.error) throw tplRes.error;
      if (trigRes && (trigRes as any).error) throw (trigRes as any).error;
      return {
        templates: tplRes.data || [],
        triggers: (trigRes && (trigRes as any).data) || [],
      };
    },
    enabled: !!effectiveBranchId,
  });

  // Realtime: refresh on templates / triggers changes.
  useEffect(() => {
    const ch = supabase
      .channel(`coverage-${channel}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'templates' }, () =>
        qc.invalidateQueries({ queryKey: ['template-coverage', channel] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, channel]);

  const rows = useMemo(() => {
    const triggers = (data?.triggers || []) as any[];
    const templates = (data?.templates || []) as any[];
    const trigByEvent = new Map(triggers.map((t) => [t.event_name, t]));
    const tplByEvent = new Map<string, any>();
    for (const t of templates) {
      if (t.trigger_event && !tplByEvent.has(t.trigger_event)) tplByEvent.set(t.trigger_event, t);
    }
    return getEventsForChannel(channel).map((e) => {
      const trig = trigByEvent.get(e.event);
      const tpl = trig?.templates || tplByEvent.get(e.event);
      const meta = (tpl?.meta_template_status || '').toUpperCase();
      let state: RowState = 'missing';
      if (tpl) {
        if (channel === 'whatsapp') {
          if (meta === 'REJECTED') state = 'rejected';
          else if (meta && meta !== 'APPROVED') state = 'pending';
          else if (tpl.is_active === false || (trig && trig.is_active === false)) state = 'inactive';
          else state = 'ok';
        } else {
          state = tpl.is_active === false ? 'inactive' : 'ok';
        }
      }
      return { ...e, tpl, state, metaName: tpl?.meta_template_name as string | undefined };
    });
  }, [data, channel]);

  const total = rows.length;
  const okCount = rows.filter((r) => r.state === 'ok').length;
  const missingEvents = rows.filter((r) => r.state === 'missing' || r.state === 'rejected').map((r) => r.event);
  const pct = total ? Math.round((okCount / total) * 100) : 0;

  const openAi = (events?: string[]) => {
    setAiSeed(events && events.length ? events : undefined);
    setAiOpen(true);
  };

  if (isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />;

  return (
    <>
      <div className="space-y-4">
        <Card className="rounded-3xl shadow-2xl shadow-slate-200/50 border-0 bg-white/70 backdrop-blur-xl">
          <CardContent className="pt-8 px-6 pb-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">System Coverage Status</p>
                  <span className="text-sm font-black text-slate-900">{okCount} of {total} Events Protected · {pct}%</span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
              <Button
                onClick={() => openAi(missingEvents)}
                disabled={missingEvents.length === 0}
                className="gap-2"
              >
                <Wand2 className="h-4 w-4" />
                Auto-fill missing with AI ({missingEvents.length})
              </Button>
              <Button variant="outline" onClick={() => openAi()} className="gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Open AI Studio
              </Button>
            </div>

            <div className="space-y-2">
              {rows.map((r) => {
                const meta = STATE_META[r.state];
                const Icon = meta.icon;
                return (
                  <div
                    key={r.event}
                    className="flex items-center justify-between p-3 rounded-xl border bg-card hover:bg-muted/60 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate text-foreground">{r.label}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.tpl ? `→ ${r.tpl.name}` : '— No template configured —'}
                        {r.metaName && <span className="ml-2 font-mono">[{r.metaName}]</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={`${meta.cls} gap-1 rounded-full`}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </Badge>
                      {(r.state === 'missing' || r.state === 'rejected') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs gap-1 text-primary hover:bg-primary/10"
                          onClick={() => openAi([r.event])}
                        >
                          <Sparkles className="h-3 w-3" /> AI Draft
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <AIGenerateTemplatesDrawer
        open={aiOpen}
        onOpenChange={setAiOpen}
        channel={channel}
        prefilledEvents={aiSeed}
      />
    </>
  );
}
