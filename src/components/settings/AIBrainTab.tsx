import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranches } from '@/hooks/useBranches';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Brain, Plus, Pencil, Trash2, Globe, MapPin, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

// All AI purpose keys defined in `_shared/ai-runtime.ts::Purpose`.
const PURPOSE_KEYS = [
  'all',
  'whatsapp_reply',
  'lead_nurture',
  'lead_score',
  'campaign_draft',
  'template_generate',
  'dashboard_insight',
  'fitness_plan',
  'review_reply',
  'automation_rule',
] as const;

type PurposeKey = (typeof PURPOSE_KEYS)[number];

interface BrainRow {
  id: string;
  branch_id: string | null;
  topic: string;
  title: string;
  content: string;
  tags: string[];
  applies_to: string[];
  priority: number;
  is_active: boolean;
  status: 'active' | 'suggested' | 'archived';
  updated_at: string;
}

interface HealthRow {
  purpose: string;
  branch_id: string | null;
  enabled: boolean;
  prompt_len: number;
  calls_24h: number;
  errors_24h: number;
  error_rate_pct: number;
  health_flag: 'healthy' | 'disabled' | 'prompt_too_short' | 'high_error_rate';
}

const HEALTH_LABEL: Record<HealthRow['health_flag'], { label: string; cls: string }> = {
  healthy: { label: 'Healthy', cls: 'bg-emerald-100 text-emerald-700' },
  disabled: { label: 'Disabled', cls: 'bg-slate-100 text-slate-600' },
  prompt_too_short: { label: 'Prompt too short', cls: 'bg-amber-100 text-amber-700' },
  high_error_rate: { label: 'High error rate', cls: 'bg-red-100 text-red-700' },
};

const EMPTY_ROW: Omit<BrainRow, 'id' | 'updated_at'> = {
  branch_id: null,
  topic: 'general',
  title: '',
  content: '',
  tags: [],
  applies_to: ['all'],
  priority: 100,
  is_active: true,
  status: 'active',
};

export function AIBrainTab() {
  const queryClient = useQueryClient();
  const { data: branches = [] } = useBranches();
  const [editing, setEditing] = useState<Partial<BrainRow> | null>(null);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['ai_knowledge_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_knowledge')
        .select('*')
        .order('priority', { ascending: true })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as BrainRow[];
    },
  });

  const { data: health } = useQuery({
    queryKey: ['ai_brain_health'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ai_brain_health')
        .select('*')
        .order('purpose');
      if (error) throw error;
      return ((data ?? []) as unknown) as HealthRow[];
    },
    refetchInterval: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (row: Partial<BrainRow>) => {
      const payload = {
        branch_id: row.branch_id ?? null,
        topic: row.topic?.trim() || 'general',
        title: row.title?.trim() || '',
        content: row.content?.trim() || '',
        tags: row.tags ?? [],
        applies_to: row.applies_to?.length ? row.applies_to : ['all'],
        priority: row.priority ?? 100,
        is_active: row.is_active ?? true,
        status: row.status ?? 'active',
      };
      if (!payload.title) throw new Error('Title is required');
      if (!payload.content) throw new Error('Content is required');

      if (row.id) {
        const { error } = await supabase.from('ai_knowledge').update(payload).eq('id', row.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ai_knowledge').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Brain entry saved');
      queryClient.invalidateQueries({ queryKey: ['ai_knowledge_all'] });
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message || 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ai_knowledge').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Entry deleted');
      queryClient.invalidateQueries({ queryKey: ['ai_knowledge_all'] });
    },
    onError: (e: any) => toast.error(e.message || 'Delete failed'),
  });

  const branchName = (id: string | null) =>
    !id ? 'Global' : branches.find((b) => b.id === id)?.name || id.slice(0, 8);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/20">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg">AI Brain — Shared Knowledge</CardTitle>
                <CardDescription>
                  One place to write what the AI knows. Every handle (WhatsApp Reply, Lead Nurture,
                  Review Reply…) reads these entries at runtime. No more duplicate persona boxes.
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={() => setEditing({ ...EMPTY_ROW })}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" /> New Entry
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Health */}
      {health && health.length > 0 && (
        <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Handle Health (last 24h)</CardTitle>
            <CardDescription>
              Self-healing checks across every AI purpose. Click a row in the table below to edit the
              relevant brain entry.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {health.map((h, i) => {
                const meta = HEALTH_LABEL[h.health_flag];
                const Icon = h.health_flag === 'healthy' ? CheckCircle2 : AlertCircle;
                return (
                  <div
                    key={`${h.purpose}-${h.branch_id ?? 'g'}-${i}`}
                    className="rounded-xl border bg-slate-50/60 p-3 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {h.purpose}
                      </p>
                      <p className="text-xs text-slate-500">
                        {h.branch_id ? branchName(h.branch_id) : 'Global'} · prompt{' '}
                        {h.prompt_len} chars · {h.calls_24h} calls · {h.error_rate_pct}% errors
                      </p>
                    </div>
                    <Badge className={`${meta.cls} gap-1 shrink-0`}>
                      <Icon className="h-3 w-3" /> {meta.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entries table */}
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : !rows || rows.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Brain className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No brain entries yet. Click <b>New Entry</b> to add your first.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Title</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead>Applies to</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead className="text-right">Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className="hover:bg-slate-50">
                      <TableCell className="font-medium text-slate-900 max-w-[260px] truncate">
                        {r.title}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.topic}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {r.applies_to.map((p) => (
                            <Badge key={p} className="bg-indigo-50 text-indigo-700 text-xs">
                              {p}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                          {r.branch_id ? (
                            <>
                              <MapPin className="h-3 w-3" /> {branchName(r.branch_id)}
                            </>
                          ) : (
                            <>
                              <Globe className="h-3 w-3" /> Global
                            </>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-slate-500">
                        {r.priority}
                      </TableCell>
                      <TableCell>
                        {r.status === 'active' && r.is_active ? (
                          <Badge className="bg-emerald-100 text-emerald-700">Active</Badge>
                        ) : r.status === 'suggested' ? (
                          <Badge className="bg-amber-100 text-amber-700">Suggested</Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-600">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Edit entry"
                            onClick={() => setEditing(r)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Delete entry"
                            className="text-red-600 hover:bg-red-50"
                            onClick={() => {
                              if (confirm(`Delete "${r.title}"?`)) deleteMutation.mutate(r.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drawer (Sheet) */}
      <Sheet open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <SheetContent className="sm:max-w-xl flex flex-col p-0">
          <SheetHeader className="px-6 pt-6 pb-4 border-b">
            <SheetTitle>{editing?.id ? 'Edit Brain Entry' : 'New Brain Entry'}</SheetTitle>
            <SheetDescription>
              Shared knowledge consumed by every AI handle whose key appears in <b>Applies to</b>.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="brain-title">Title</Label>
                <Input
                  id="brain-title"
                  value={editing?.title ?? ''}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  placeholder="e.g. New Year offer — 20% off annual"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brain-topic">Topic</Label>
                <Input
                  id="brain-topic"
                  value={editing?.topic ?? ''}
                  onChange={(e) => setEditing({ ...editing, topic: e.target.value })}
                  placeholder="offers, faq, behavior_rules, identity_rules…"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brain-content">Content</Label>
              <Textarea
                id="brain-content"
                rows={8}
                className="font-mono text-xs"
                value={editing?.content ?? ''}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                placeholder="The actual text that will be injected into the system prompt."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Applies to</Label>
                <div className="flex flex-wrap gap-1.5 p-2 rounded-md border bg-slate-50/60 min-h-[42px]">
                  {PURPOSE_KEYS.map((p) => {
                    const active = (editing?.applies_to ?? ['all']).includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          const cur = new Set(editing?.applies_to ?? ['all']);
                          if (active) cur.delete(p);
                          else cur.add(p);
                          if (p === 'all' && !active) {
                            setEditing({ ...editing, applies_to: ['all'] });
                            return;
                          }
                          if (p !== 'all' && !active) cur.delete('all');
                          setEditing({
                            ...editing,
                            applies_to: Array.from(cur as Set<PurposeKey>).filter(Boolean),
                          });
                        }}
                        className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                          active
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Pick <b>all</b> to share across every AI handle, or select specific ones.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Branch scope</Label>
                <Select
                  value={editing?.branch_id ?? '__global__'}
                  onValueChange={(v) =>
                    setEditing({ ...editing, branch_id: v === '__global__' ? null : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Global" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__global__">Global (all branches)</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="brain-priority">Priority</Label>
                <Input
                  id="brain-priority"
                  type="number"
                  min={1}
                  max={999}
                  value={editing?.priority ?? 100}
                  onChange={(e) =>
                    setEditing({ ...editing, priority: parseInt(e.target.value) || 100 })
                  }
                />
                <p className="text-[11px] text-muted-foreground">Lower number = appears earlier.</p>
              </div>

              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={editing?.status ?? 'active'}
                  onValueChange={(v) =>
                    setEditing({ ...editing, status: v as BrainRow['status'] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="suggested">Suggested</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Enabled</Label>
                <div className="flex items-center h-10 gap-2">
                  <Switch
                    checked={editing?.is_active ?? true}
                    onCheckedChange={(v) => setEditing({ ...editing, is_active: v })}
                  />
                  <span className="text-xs text-muted-foreground">
                    Off = excluded from prompt assembly.
                  </span>
                </div>
              </div>
            </div>
          </div>

          <SheetFooter className="px-6 py-4 border-t bg-white">
            <div className="flex items-center justify-end gap-2 w-full">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => editing && saveMutation.mutate(editing)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? 'Saving…' : 'Save Entry'}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
