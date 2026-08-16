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
  ok: { label: 'Ready', icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pending: { label: 'Pending', icon: ShieldAlert, cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  rejected: { label: 'Rejected', icon: ShieldX, cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  inactive: { label: 'Inactive', icon: AlertCircle, cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  missing: { label: 'Missing', icon: AlertCircle, cls: 'bg-slate-50 text-slate-400 border-slate-200' },
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
        tplQ, // Templates are global, but we can filter by branch_id if it's set on the template
        triggersQ,
      ]);
      if (tplRes.error) throw tplRes.error;
      if (trigRes && (trigRes as any).error) throw (trigRes as any).error;
      
      // Filter templates that either have no branch_id (global) or match the effectiveBranchId
      const filteredTemplates = (tplRes.data || []).filter(t => 
        !(t as any).branch_id || (t as any).branch_id === effectiveBranchId
      );

      return {
        templates: filteredTemplates,
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

  if (isLoading) return <Skeleton className="h-72 w-full rounded-3xl shadow-xl" />;

  return (
    <>
      <div className="space-y-4">
        <Card className="rounded-3xl shadow-2xl shadow-slate-200/50 border-0 bg-white/70 backdrop-blur-xl">
          <CardContent className="pt-8 px-6 pb-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-6">
              <div className="flex-1 min-w-[280px]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">System Coverage Status</p>
                  <span className="text-sm font-black text-slate-900">{okCount} of {total} Events Protected · {pct}%</span>
                </div>
                <Progress value={pct} className="h-2.5 bg-slate-100 [&>div]:bg-indigo-600 [&>div]:shadow-[0_0_8px_rgba(79,70,229,0.4)] rounded-full" />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => openAi(missingEvents)}
                  disabled={missingEvents.length === 0}
                  className="gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100 text-white font-semibold px-5 h-11 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Wand2 className="h-4 w-4" />
                  Auto-fill Missing ({missingEvents.length})
                </Button>
                <Button variant="outline" onClick={() => openAi()} className="gap-2 rounded-xl border-slate-200 hover:bg-slate-50 font-semibold px-5 h-11 text-slate-700 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]">
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  Studio
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
              {rows.map((r) => {
                const meta = STATE_META[r.state];
                const Icon = meta.icon;
                return (
                  <div
                    key={r.event}
                    className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 bg-white hover:border-indigo-100 hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-300 group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-bold text-sm tracking-tight text-slate-900 group-hover:text-indigo-700 transition-colors">{r.label}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] font-medium text-slate-400 truncate max-w-[150px]">
                          {r.tpl ? `→ ${r.tpl.name}` : 'No active template'}
                        </p>
                        {r.metaName && (
                          <Badge variant="secondary" className="bg-slate-50 text-slate-500 border-0 h-4 text-[9px] px-1.5 font-mono rounded-md">
                            {r.metaName}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={`${meta.cls} gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border shadow-sm`}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </Badge>
                      {(r.state === 'missing' || r.state === 'rejected') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 rounded-full text-indigo-600 hover:bg-indigo-50 transition-colors"
                          onClick={() => openAi([r.event])}
                          title="Generate with AI"
                        >
                          <Sparkles className="h-4 w-4" />
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
