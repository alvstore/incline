import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronDown, FileClock, Loader2, Trash2, ArrowRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { track } from '@/lib/analytics';
import { groupDraftSlips, type DraftSlip } from '@/lib/hrm/draftSlipGroups';

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const monthLabel = (m: string) => format(new Date(`${m}-01T00:00:00`), 'MMMM yyyy');

type Pending = { ids: string[]; title: string; detail: string; month: string };

/** Unpaid salary slips from earlier months, grouped by month and collapsed by default. */
export function DraftSlipsCard({ branchId, currentMonth, onOpenMonth }: { branchId?: string | null; currentMonth: string; onOpenMonth?: (month: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [openMonths, setOpenMonths] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['payroll-draft-slips', branchId],
    queryFn: async (): Promise<DraftSlip[]> => {
      let q = supabase.from('payroll_items')
        .select('id, user_id, final_net, status, payroll_runs!inner(period_start, branch_id)')
        .not('status', 'in', '(paid,cancelled)')
        .order('created_at', { ascending: false }).limit(500);
      if (branchId) q = q.eq('payroll_runs.branch_id', branchId);
      const { data: rows, error } = await q;
      if (error) throw error;
      const ids = [...new Set((rows ?? []).map(r => r.user_id))];
      const { data: profs } = ids.length ? await supabase.from('profiles').select('id, full_name').in('id', ids) : { data: [] };
      const names = new Map((profs ?? []).map(p => [p.id, p.full_name ?? 'Staff']));
      return (rows ?? []).map(r => {
        const run = r.payroll_runs as unknown as { period_start: string };
        return { id: r.id, user_id: r.user_id, final_net: Number(r.final_net), period_start: run.period_start, name: names.get(r.user_id) ?? 'Staff' };
      }).filter(r => r.period_start.slice(0, 7) < currentMonth);
    },
  });

  const groups = useMemo(() => groupDraftSlips(data), [data]);
  const grandTotal = groups.reduce((t, g) => t + g.total, 0);

  const discardMut = useMutation({
    mutationFn: async (p: Pending) => {
      const { error } = await supabase.rpc('payroll_discard_slips', { p_item_ids: p.ids, p_reason: 'Discarded by management (unpaid earlier-month slip)' });
      if (error) throw error;
    },
    onSuccess: (_d, p) => {
      track('payroll_draft_discarded', { month: p.month, count: p.ids.length });
      toast.success(p.ids.length === 1 ? 'Slip discarded' : `${p.ids.length} slips discarded`);
      setPending(null);
      ['payroll-draft-slips', 'payroll-items', 'payroll-runs'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: () => toast.error('Could not discard. Please try again.'),
  });

  if (isLoading) return null;
  if (isError) return (
    <Card className="mb-4 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">Couldn't load unpaid slips from earlier months.</p>
      <Button variant="outline" size="sm" className="min-h-11" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" aria-hidden />Retry</Button>
    </Card>
  );
  if (groups.length === 0) return null;

  const toggleMonth = (m: string) => setOpenMonths(s => s.includes(m) ? s.filter(x => x !== m) : [...s, m]);

  return (
    <Card className="mb-4 rounded-2xl">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="rounded-full bg-primary/10 p-2 text-primary"><FileClock className="h-4 w-4" aria-hidden /></span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{data.length} unpaid slips from earlier months · {inr(grandTotal)}</p>
              <p className="text-xs text-muted-foreground">{groups.map(g => `${format(new Date(`${g.month}-01T00:00:00`), 'MMM')} ${g.slips.length}`).join(' · ')}</p>
            </div>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="min-h-11" aria-expanded={open}>
              {open ? 'Hide' : 'Review'}<ChevronDown className={`ml-1 h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <p className="px-4 pb-2 text-xs text-muted-foreground">Open a month to preview and pay, or discard slips you already paid outside the app. Discarding keeps history and leaves PT commissions due.</p>
          <ul className="divide-y divide-border border-t border-border">
            {groups.map(g => {
              const expanded = openMonths.includes(g.month);
              return (
                <li key={g.month} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button type="button" className="flex min-h-11 items-center gap-2 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={expanded} onClick={() => toggleMonth(g.month)}>
                      <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`} aria-hidden />
                      <span className="text-sm font-medium">{monthLabel(g.month)}</span>
                      <span className="text-xs text-muted-foreground">{g.slips.length} slips · <span className="tabular-nums">{inr(g.total)}</span></span>
                    </button>
                    <div className="flex gap-2">
                      {onOpenMonth && <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onOpenMonth(g.month)}>Open month<ArrowRight className="ml-1 h-4 w-4" aria-hidden /></Button>}
                      <Button variant="outline" size="sm" className="min-h-11" onClick={() => setPending({ ids: g.slips.map(s => s.id), month: g.month, title: `Discard all ${g.slips.length} slips for ${monthLabel(g.month)}?`, detail: `Total ${inr(g.total)}. They stay in history as discarded; no money moves.` })}>
                        <Trash2 className="mr-1 h-4 w-4" aria-hidden />Discard month
                      </Button>
                    </div>
                  </div>
                  {expanded && (
                    <ul className="mt-2 ml-6 divide-y divide-border">
                      {g.slips.map(s => (
                        <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                          <span className="truncate text-sm">{s.name}</span>
                          <span className="flex items-center gap-1">
                            <span className="text-sm tabular-nums">{inr(s.final_net)}</span>
                            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Discard ${s.name}'s ${monthLabel(g.month)} slip`} onClick={() => setPending({ ids: [s.id], month: g.month, title: 'Discard this slip?', detail: `${s.name} · ${monthLabel(g.month)} · ${inr(s.final_net)}. Kept in history as discarded; no money moves.` })}>
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </CollapsibleContent>
      </Collapsible>
      <AlertDialog open={!!pending} onOpenChange={o => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.detail}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction disabled={discardMut.isPending} onClick={e => { e.preventDefault(); if (pending) discardMut.mutate(pending); }}>
              {discardMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
