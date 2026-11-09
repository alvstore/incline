import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { FileClock, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { track } from '@/lib/analytics';

interface DraftSlip { id: string; user_id: string; final_net: number; period_start: string; name: string }

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Unpaid salary slips from earlier months — process them by switching to that month, or discard. */
export function DraftSlipsCard({ branchId, currentMonth }: { branchId?: string | null; currentMonth: string }) {
  const qc = useQueryClient();
  const [discard, setDiscard] = useState<DraftSlip | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['payroll-draft-slips', branchId],
    queryFn: async (): Promise<DraftSlip[]> => {
      let q = supabase.from('payroll_items')
        .select('id, user_id, final_net, status, payroll_runs!inner(period_start, branch_id)')
        .not('status', 'in', '(paid,cancelled)')
        .order('created_at', { ascending: false }).limit(100);
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

  const discardMut = useMutation({
    mutationFn: async (slip: DraftSlip) => {
      const { error } = await supabase.from('payroll_items')
        .update({ status: 'cancelled', adjustment_reason: 'Discarded by management' })
        .eq('id', slip.id).neq('status', 'paid');
      if (error) throw error;
    },
    onSuccess: (_d, slip) => {
      track('payroll_draft_discarded', { month: slip.period_start.slice(0, 7) });
      toast.success('Draft slip discarded');
      setDiscard(null);
      qc.invalidateQueries({ queryKey: ['payroll-draft-slips'] });
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || data.length === 0) return null;

  return (
    <Card className="mb-4 rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FileClock className="h-4 w-4 text-primary" aria-hidden />Unpaid slips from earlier months ({data.length})</CardTitle>
        <CardDescription>Choose that month above to preview and pay, or discard a slip that is no longer needed. Trainers see these as “Draft”.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {data.map(s => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground">{format(new Date(s.period_start), 'MMMM yyyy')} · Draft</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">{inr(s.final_net)}</span>
                <Button variant="outline" size="sm" className="min-h-11" aria-label={`Discard ${s.name}'s draft slip`} onClick={() => setDiscard(s)}>
                  <Trash2 className="mr-1 h-4 w-4" aria-hidden />Discard
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <AlertDialog open={!!discard} onOpenChange={o => !o && setDiscard(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft slip?</AlertDialogTitle>
            <AlertDialogDescription>
              {discard && `${discard.name} · ${format(new Date(discard.period_start), 'MMMM yyyy')} · ${inr(discard.final_net)}. It is kept in history as cancelled; no money moves.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction disabled={discardMut.isPending} onClick={e => { e.preventDefault(); if (discard) discardMut.mutate(discard); }}>
              {discardMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
