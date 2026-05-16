import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Bot, Play, Pencil, Activity, AlertTriangle, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

type Rule = {
  id: string;
  branch_id: string | null;
  key: string;
  name: string;
  description: string | null;
  category: string;
  worker: string;
  cron_expression: string;
  is_active: boolean;
  use_ai: boolean;
  ai_tone: string | null;
  target_filter: any;
  last_run_at: string | null;
  next_run_at: string;
  last_status: string | null;
  last_error: string | null;
  last_dispatched_count: number;
  is_system: boolean;
};

type Run = {
  id: string;
  rule_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  dispatched_count: number;
  error_message: string | null;
};

const CATEGORY_COLOR: Record<string, string> = {
  billing: 'bg-amber-100 text-amber-700',
  booking: 'bg-sky-100 text-sky-700',
  engagement: 'bg-violet-100 text-violet-700',
  lifecycle: 'bg-emerald-100 text-emerald-700',
  system: 'bg-slate-100 text-slate-700',
};

const STATUS_COLOR: Record<string, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
  running: 'bg-sky-100 text-sky-700',
  skipped: 'bg-slate-100 text-slate-600',
};

function describeCron(expr: string): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [m, h, dom, mon, dow] = p;
  if (m === '*' && h === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';
  if (m.startsWith('*/') && h === '*' && dom === '*' && mon === '*' && dow === '*')
    return `Every ${m.slice(2)} minutes`;
  if (h === '*' && dom === '*' && mon === '*' && dow === '*') return `At minute ${m} of every hour`;
  if (dom === '*' && mon === '*' && dow === '*')
    return `Every day at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return expr;
}

const PRESETS = [
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 8:00 AM', value: '0 8 * * *' },
  { label: 'Daily at 9:30 AM', value: '30 9 * * *' },
  { label: 'Daily at 9:00 PM', value: '0 21 * * *' },
];

export function AutomationsControlRoom() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Rule | null>(null);

  const rulesQuery = useQuery({
    queryKey: ['automation-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('automation_rules' as any)
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Rule[];
    },
  });

  const runsQuery = useQuery({
    queryKey: ['automation-runs-recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('automation_runs' as any)
        .select('*')
        .order('started_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as unknown as Run[];
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

  const stats = useMemo(() => {
    const last24 = Date.now() - 24 * 3600 * 1000;
    const recent = runs.filter((r) => new Date(r.started_at).getTime() > last24);
    return {
      active: rules.filter((r) => r.is_active).length,
      total: rules.length,
      runs24: recent.length,
      failures24: recent.filter((r) => r.status === 'error').length,
      dispatched24: recent.reduce((acc, r) => acc + (r.dispatched_count || 0), 0),
    };
  }, [rules, runs]);

  const grouped = useMemo(() => {
    const g: Record<string, Rule[]> = {};
    for (const r of rules) (g[r.category] ??= []).push(r);
    return g;
  }, [rules]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="bg-violet-50 text-violet-600 p-3 rounded-2xl">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Automation Brain</h2>
          <p className="text-sm text-slate-500 mt-1">
            One intelligent orchestrator runs every 5 minutes and dispatches all your reminders, nudges, retries and AI-driven follow-ups. Pause, edit, or run any automation from here — no code required.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Active rules', value: `${stats.active}/${stats.total}`, icon: CheckCircle2, color: 'emerald' },
          { label: 'Runs (24h)', value: stats.runs24, icon: Activity, color: 'sky' },
          { label: 'Failures (24h)', value: stats.failures24, icon: AlertTriangle, color: 'rose' },
          { label: 'Dispatched (24h)', value: stats.dispatched24, icon: Sparkles, color: 'violet' },
        ].map((k) => (
          <Card key={k.label} className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{k.label}</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{k.value}</p>
              </div>
              <div className={`bg-${k.color}-50 text-${k.color}-600 p-2 rounded-full`}>
                <k.icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Rules grouped by category */}
      {rulesQuery.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : (
        Object.entries(grouped).map(([cat, list]) => (
          <Card key={cat} className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base capitalize">
                <Badge className={CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.system}>{cat}</Badge>
                <span className="text-slate-700">{list.length} automations</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-slate-100">
              {list.map((r) => (
                <div key={r.id} className="py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900 truncate">{r.name}</p>
                      {r.use_ai && (
                        <Badge className="bg-violet-100 text-violet-700 gap-1">
                          <Sparkles className="h-3 w-3" /> AI
                        </Badge>
                      )}
                      {r.last_status && (
                        <Badge className={STATUS_COLOR[r.last_status] ?? STATUS_COLOR.skipped}>
                          {r.last_status}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1 truncate">{r.description}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {describeCron(r.cron_expression)}
                      </span>
                      {r.last_run_at && (
                        <span>· Last run {formatDistanceToNow(new Date(r.last_run_at), { addSuffix: true })}</span>
                      )}
                      <span>· Next {formatDistanceToNow(new Date(r.next_run_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <Switch
                    checked={r.is_active}
                    onCheckedChange={(v) => toggle.mutate({ id: r.id, active: v })}
                    aria-label="Toggle rule"
                  />
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => runNow.mutate(r.id)}>
                    <Play className="h-4 w-4 mr-1" /> Run now
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setEditing(r)}>
                    <Pencil className="h-4 w-4 mr-1" /> Edit
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {/* Run history */}
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-600" /> Recent runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No runs recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 text-sm">
              {runs.slice(0, 30).map((r) => {
                const rule = rules.find((x) => x.id === r.rule_id);
                return (
                  <div key={r.id} className="py-2 flex items-center gap-3">
                    <Badge className={STATUS_COLOR[r.status] ?? STATUS_COLOR.skipped}>{r.status}</Badge>
                    <span className="font-medium text-slate-700 flex-1 truncate">{rule?.name ?? r.rule_id}</span>
                    <span className="text-xs text-slate-500">{r.dispatched_count} dispatched</span>
                    <span className="text-xs text-slate-400">{format(new Date(r.started_at), 'MMM d HH:mm')}</span>
                    {r.error_message && (
                      <span className="text-xs text-rose-600 truncate max-w-[240px]" title={r.error_message}>
                        {r.error_message}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <EditDrawer
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

function EditDrawer({ rule, onClose, onSaved }: { rule: Rule | null; onClose: () => void; onSaved: () => void }) {
  const [cron, setCron] = useState(rule?.cron_expression ?? '');
  const [useAi, setUseAi] = useState(rule?.use_ai ?? false);
  const [tone, setTone] = useState(rule?.ai_tone ?? 'friendly');
  const [name, setName] = useState(rule?.name ?? '');
  const [desc, setDesc] = useState(rule?.description ?? '');
  const [saving, setSaving] = useState(false);

  // Reset state when rule changes
  useMemo(() => {
    if (rule) {
      setCron(rule.cron_expression);
      setUseAi(rule.use_ai);
      setTone(rule.ai_tone ?? 'friendly');
      setName(rule.name);
      setDesc(rule.description ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule?.id]);

  if (!rule) return null;

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('admin_update_automation_rule' as any, {
      _rule_id: rule.id,
      _cron_expression: cron,
      _use_ai: useAi,
      _ai_tone: tone,
      _target_filter: rule.target_filter ?? {},
      _name: name,
      _description: desc,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Automation updated');
    onSaved();
  };

  return (
    <Sheet open={!!rule} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-violet-600" /> Edit automation
          </SheetTitle>
          <SheetDescription>
            Adjust schedule, enable AI personalisation, or rename. Changes apply on the next tick.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 py-5">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={desc ?? ''} onChange={(e) => setDesc(e.target.value)} className="rounded-xl" rows={2} />
          </div>

          <div>
            <Label>Frequency preset</Label>
            <Select value={cron} onValueChange={setCron}>
              <SelectTrigger className="rounded-xl"><SelectValue placeholder="Pick a preset…" /></SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label} <span className="text-slate-400 ml-2">{p.value}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Custom cron expression</Label>
            <Input value={cron} onChange={(e) => setCron(e.target.value)} className="rounded-xl font-mono" placeholder="m h dom mon dow" />
            <p className="text-xs text-slate-500 mt-1">{describeCron(cron)}</p>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-violet-50/60 p-4">
            <div>
              <p className="font-semibold text-slate-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600" /> Use AI Brain
              </p>
              <p className="text-xs text-slate-600 mt-1">Lovable AI personalises message copy per recipient.</p>
            </div>
            <Switch checked={useAi} onCheckedChange={setUseAi} />
          </div>

          {useAi && (
            <div>
              <Label>AI tone</Label>
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="friendly">Friendly</SelectItem>
                  <SelectItem value="formal">Formal</SelectItem>
                  <SelectItem value="motivational">Motivational</SelectItem>
                  <SelectItem value="casual">Casual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
            <p><span className="font-semibold">Worker:</span> <span className="font-mono">{rule.worker}</span></p>
            <p><span className="font-semibold">Key:</span> <span className="font-mono">{rule.key}</span></p>
            {rule.is_system && <p className="text-amber-700">System automation — worker cannot be changed.</p>}
          </div>
        </div>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={save} disabled={saving} className="rounded-xl">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
