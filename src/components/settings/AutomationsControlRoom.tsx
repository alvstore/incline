import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
  Bot, Activity, AlertTriangle, CheckCircle2, Sparkles, Search,
  Filter, ChevronDown, Play, RefreshCw,
} from 'lucide-react';
import { AutomationRuleRow } from './automations/AutomationRuleRow';
import { AutomationActivityRail } from './automations/AutomationActivityRail';
import { AutomationEditSheet } from './automations/AutomationEditSheet';
import { type AutomationRule, type AutomationRun, CATEGORY_COLOR } from './automations/types';

export function AutomationsControlRoom() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [failingOnly, setFailingOnly] = useState(false);
  const [aiOnly, setAiOnly] = useState(false);
  const [railFilterRuleId, setRailFilterRuleId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const rulesQuery = useQuery({
    queryKey: ['automation-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('automation_rules' as any)
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as AutomationRule[];
    },
  });

  const runsQuery = useQuery({
    queryKey: ['automation-runs-recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('automation_runs' as any)
        .select('*')
        .order('started_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as AutomationRun[];
    },
    refetchInterval: 15000,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.rpc('admin_toggle_automation_rule' as any, { _rule_id: id, _active: active });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Updated');
      qc.invalidateQueries({ queryKey: ['automation-rules'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const runNow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('admin_run_automation_now' as any, { _rule_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Queued — will run within 5 minutes');
      qc.invalidateQueries({ queryKey: ['automation-rules'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rules = useMemo(() => rulesQuery.data ?? [], [rulesQuery.data]);
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);

  // KPI strip
  const stats = useMemo(() => {
    const now = Date.now();
    const last24 = now - 24 * 3600 * 1000;
    const prev24 = now - 48 * 3600 * 1000;
    const recent = runs.filter((r) => new Date(r.started_at).getTime() > last24);
    const prev = runs.filter((r) => {
      const t = new Date(r.started_at).getTime();
      return t > prev24 && t <= last24;
    });
    return {
      active: rules.filter((r) => r.is_active).length,
      total: rules.length,
      runs24: recent.length,
      runs24Prev: prev.length,
      failures24: recent.filter((r) => r.status === 'error').length,
      failures24Prev: prev.filter((r) => r.status === 'error').length,
      dispatched24: recent.reduce((acc, r) => acc + (r.dispatched_count || 0), 0),
      dispatched24Prev: prev.reduce((acc, r) => acc + (r.dispatched_count || 0), 0),
    };
  }, [rules, runs]);

  // Apply filters
  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (failingOnly && r.last_status !== 'error') return false;
      if (aiOnly && !r.use_ai) return false;
      if (search) {
        const s = search.toLowerCase();
        if (!r.name.toLowerCase().includes(s) && !(r.description ?? '').toLowerCase().includes(s) && !r.key.includes(s)) return false;
      }
      return true;
    });
  }, [rules, category, failingOnly, aiOnly, search]);

  const grouped = useMemo(() => {
    const g: Record<string, AutomationRule[]> = {};
    for (const r of filteredRules) (g[r.category] ??= []).push(r);
    return g;
  }, [filteredRules]);

  const runsByRule = useMemo(() => {
    const m: Record<string, AutomationRun[]> = {};
    for (const r of runs) (m[r.rule_id] ??= []).push(r);
    return m;
  }, [runs]);

  const categories = useMemo(() => Array.from(new Set(rules.map((r) => r.category))).sort(), [rules]);

  const kpis: Array<{ label: string; value: string | number; icon: typeof Activity; tone: string; trend: string | null }> = [
    {
      label: 'Active rules',
      value: `${stats.active}/${stats.total}`,
      icon: CheckCircle2,
      tone: 'bg-emerald-50 text-emerald-600',
      trend: null,
    },
    {
      label: 'Runs (24h)',
      value: stats.runs24,
      icon: Activity,
      tone: 'bg-sky-50 text-sky-600',
      trend: trendString(stats.runs24, stats.runs24Prev),
    },
    {
      label: 'Failures (24h)',
      value: stats.failures24,
      icon: AlertTriangle,
      tone: stats.failures24 > 0 ? 'bg-rose-50 text-rose-600' : 'bg-slate-50 text-slate-500',
      trend: trendString(stats.failures24, stats.failures24Prev, true),
    },
    {
      label: 'Dispatched (24h)',
      value: stats.dispatched24,
      icon: Sparkles,
      tone: 'bg-violet-50 text-violet-600',
      trend: trendString(stats.dispatched24, stats.dispatched24Prev),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="bg-gradient-to-br from-violet-500 to-indigo-600 text-white p-3 rounded-2xl shadow-lg shadow-violet-500/30">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Automation Brain</h2>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              One orchestrator dispatches every reminder, nudge, retry and AI follow-up — including Instagram comment-to-DM. Pause, edit, or run anything from here.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          className="rounded-xl"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['automation-rules'] });
            qc.invalidateQueries({ queryKey: ['automation-runs-recent'] });
          }}
        >
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label} className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{k.label}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{k.value}</p>
                {k.trend && <p className="text-xs text-slate-500 mt-1">{k.trend}</p>}
              </div>
              <div className={`${k.tone} p-2 rounded-full`}>
                <k.icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Two-column layout: rules + rail */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          {/* Toolbar */}
          <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
            <CardContent className="p-3 flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search automations…"
                  className="pl-9 rounded-xl border-slate-200"
                />
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="rounded-xl w-[170px]">
                  <Filter className="h-4 w-4 mr-1 text-slate-400" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <Switch checked={failingOnly} onCheckedChange={setFailingOnly} aria-label="Failing only" />
                <span className="text-sm text-slate-700">Failing only</span>
              </label>
              <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
                <Switch checked={aiOnly} onCheckedChange={setAiOnly} aria-label="AI only" />
                <span className="text-sm text-slate-700">AI only</span>
              </label>
            </CardContent>
          </Card>

          {/* Rules grouped */}
          {rulesQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
            </div>
          ) : filteredRules.length === 0 ? (
            <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
              <CardContent className="p-10 text-center text-slate-500">
                <Bot className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                <p className="text-sm">No automations match your filters.</p>
              </CardContent>
            </Card>
          ) : (
            Object.entries(grouped).map(([cat, list]) => {
              const failing = list.filter((r) => r.last_status === 'error').length;
              const isOpen = collapsed[cat] !== true;
              return (
                <Collapsible key={cat} open={isOpen} onOpenChange={(o) => setCollapsed((p) => ({ ...p, [cat]: !o }))}>
                  <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
                    <CollapsibleTrigger asChild>
                      <CardHeader className="pb-3 cursor-pointer hover:bg-slate-50/50 rounded-t-2xl">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                          <Badge className={`${CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.system} capitalize hover:opacity-100`}>{cat}</Badge>
                          <span className="text-slate-700 text-sm font-normal">{list.length} automation{list.length === 1 ? '' : 's'}</span>
                          {failing > 0 && (
                            <Badge className="bg-rose-100 text-rose-700 gap-1 ml-auto hover:bg-rose-100">
                              <AlertTriangle className="h-3 w-3" /> {failing} failing
                            </Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="divide-y divide-slate-100 pt-0">
                        {list.map((r) => (
                          <AutomationRuleRow
                            key={r.id}
                            rule={r}
                            recentRuns={runsByRule[r.id] ?? []}
                            onToggle={(v) => toggle.mutate({ id: r.id, active: v })}
                            onRunNow={() => runNow.mutate(r.id)}
                            onEdit={() => setEditing(r)}
                            onFocusRail={() => setRailFilterRuleId(r.id)}
                          />
                        ))}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            })
          )}
        </div>

        {/* Activity rail */}
        <AutomationActivityRail
          runs={runs}
          rules={rules}
          filterRuleId={railFilterRuleId}
          onClearFilter={() => setRailFilterRuleId(null)}
        />
      </div>

      <AutomationEditSheet
        rule={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          qc.invalidateQueries({ queryKey: ['automation-rules'] });
        }}
      />
    </div>
  );
}

function trendString(current: number, prev: number, lowerIsBetter = false): string | null {
  if (prev === 0 && current === 0) return null;
  if (prev === 0) return `+${current} vs prior 24h`;
  const delta = current - prev;
  if (delta === 0) return 'flat vs prior 24h';
  const pct = Math.round((delta / prev) * 100);
  const arrow = delta > 0 ? '▲' : '▼';
  const positive = lowerIsBetter ? delta < 0 : delta > 0;
  const color = positive ? 'good' : 'bad';
  return `${arrow} ${Math.abs(pct)}% vs prior 24h${color === 'bad' && lowerIsBetter ? ' ⚠' : ''}`;
}
