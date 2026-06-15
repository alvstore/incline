// AI Training tab — admin-managed dynamic memory rules.
// Mounted inside AIAgentControlCenter. Backed by `ai_dynamic_memory` table.
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Sparkles, Search, FlaskConical } from 'lucide-react';
import { AITrainingRuleSheet, type AITrainingRule } from './AITrainingRuleSheet';
import { cn } from '@/lib/utils';

const INTENT_BADGE: Record<string, string> = {
  location:   'bg-indigo-100 text-indigo-700 hover:bg-indigo-100',
  pricing:    'bg-amber-100 text-amber-700 hover:bg-amber-100',
  timeline:   'bg-violet-100 text-violet-700 hover:bg-violet-100',
  handoff:    'bg-red-100 text-red-700 hover:bg-red-100',
  decline:    'bg-slate-200 text-slate-700 hover:bg-slate-200',
  name_block: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  custom:     'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
};

interface Row {
  id: string;
  phrase_or_pattern: string;
  intent_category: string;
  correction_instruction: string;
  match_type: string;
  priority: number;
  is_active: boolean;
}

function matches(row: Row, sample: string): boolean {
  if (!sample) return false;
  const t = sample.toLowerCase().trim();
  const p = row.phrase_or_pattern.toLowerCase().trim();
  try {
    if (row.match_type === 'exact') return t === p;
    if (row.match_type === 'contains') return t.includes(p);
    if (row.match_type === 'regex') return new RegExp(row.phrase_or_pattern, 'i').test(sample);
  } catch { /* bad regex */ }
  return false;
}

export function AITrainingTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [sample, setSample] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<AITrainingRule | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['ai_dynamic_memory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_dynamic_memory')
        .select('id, phrase_or_pattern, intent_category, correction_instruction, match_type, priority, is_active')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('ai_dynamic_memory').update({ is_active }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai_dynamic_memory'] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('ai_dynamic_memory').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai_dynamic_memory'] });
      toast.success('Rule deleted');
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rows;
    return rows.filter(r =>
      r.phrase_or_pattern.toLowerCase().includes(q) ||
      r.intent_category.toLowerCase().includes(q) ||
      r.correction_instruction.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const liveMatch = useMemo(() => {
    if (!sample.trim()) return null;
    const sorted = [...rows].filter(r => r.is_active).sort((a, b) => b.priority - a.priority);
    return sorted.find(r => matches(r, sample)) ?? null;
  }, [sample, rows]);

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50 border-0">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-600" />
              AI Training Rules
            </CardTitle>
            <CardDescription className="mt-1">
              Teach the AI how to react to specific phrases. Changes go live within 60 seconds.
            </CardDescription>
          </div>
          <Button onClick={() => { setEditing(null); setSheetOpen(true); }} className="shrink-0">
            <Plus className="h-4 w-4 mr-1.5" />
            Add Rule
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search phrases, intents, instructions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="relative">
              <FlaskConical className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Test a sample message..."
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {sample.trim() && (
            <div className={cn(
              'rounded-xl px-4 py-3 text-sm',
              liveMatch ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-50 text-slate-600'
            )}>
              {liveMatch ? (
                <>
                  Matches rule <span className="font-semibold">"{liveMatch.phrase_or_pattern}"</span>
                  {' '}→ <Badge className={INTENT_BADGE[liveMatch.intent_category]}>{liveMatch.intent_category}</Badge>
                </>
              ) : (
                <>No rule matches — the AI will fall back to its hardcoded defaults.</>
              )}
            </div>
          )}

          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead className="w-[200px]">Phrase</TableHead>
                  <TableHead className="w-[130px]">Intent</TableHead>
                  <TableHead>Instruction</TableHead>
                  <TableHead className="w-[90px]">Match</TableHead>
                  <TableHead className="w-[80px]">Priority</TableHead>
                  <TableHead className="w-[80px]">Active</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                      {search ? 'No rules match your search.' : 'No training rules yet. Add your first one above.'}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50/50">
                    <TableCell className="font-medium font-mono text-sm">{r.phrase_or_pattern}</TableCell>
                    <TableCell>
                      <Badge className={INTENT_BADGE[r.intent_category] ?? INTENT_BADGE.custom}>
                        {r.intent_category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-600 max-w-md truncate" title={r.correction_instruction}>
                      {r.correction_instruction}
                    </TableCell>
                    <TableCell className="text-xs uppercase text-slate-500">{r.match_type}</TableCell>
                    <TableCell className="text-sm">{r.priority}</TableCell>
                    <TableCell>
                      <Switch
                        checked={r.is_active}
                        onCheckedChange={(v) => toggleActive.mutate({ id: r.id, is_active: v })}
                        aria-label="Toggle active"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(r as AITrainingRule); setSheetOpen(true); }} aria-label="Edit rule">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(r.id)} aria-label="Delete rule">
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AITrainingRuleSheet open={sheetOpen} onOpenChange={setSheetOpen} rule={editing} />

      <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete training rule?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will stop applying this rule immediately. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && remove.mutate(deleteId)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
