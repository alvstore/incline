import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { pendingAdvanceForUser, applyAdvanceRecovery } from '@/services/expenseService';
import { ClipboardCheck, CheckCircle2, Send, Banknote, PlusCircle, Loader2, Pencil, HandCoins, Eye } from 'lucide-react';
import { PayrollAdjustmentDrawer } from './PayrollAdjustmentDrawer';
import { PayrollProcessPreviewDrawer } from './PayrollProcessPreviewDrawer';
import { useAuth } from '@/hooks/useAuth';

type Status = 'draft' | 'reviewed' | 'approved' | 'processed' | 'paid';

const STATUS_BADGE: Record<Status, string> = {
  draft: 'bg-muted text-foreground',
  reviewed: 'bg-info/15 text-info',
  approved: 'bg-primary/15 text-primary',
  processed: 'bg-warning/15 text-warning',
  paid: 'bg-success/15 text-success',
};

interface Props {
  branchId?: string | null;
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;   // yyyy-MM-dd
}

export function PayrollRunPanel({ branchId, periodStart, periodEnd }: Props) {
  const qc = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [adjustItem, setAdjustItem] = useState<any | null>(null);
  const [adjustReason, setAdjustReason] = useState('');
  const [payMethod, setPayMethod] = useState('bank_transfer');
  const [payRef, setPayRef] = useState('');
  const [payOpen, setPayOpen] = useState(false);

  const { data: runs = [] } = useQuery({
    queryKey: ['payroll-runs', branchId, periodStart, periodEnd],
    queryFn: async () => {
      let q = supabase.from('payroll_runs').select('*')
        .eq('period_start', periodStart).eq('period_end', periodEnd)
        .order('created_at', { ascending: false });
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const activeRunId = selectedRunId || runs[0]?.id || null;

  const { data: items = [] } = useQuery({
    queryKey: ['payroll-items', activeRunId],
    enabled: !!activeRunId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_items')
        .select('*')
        .eq('run_id', activeRunId);
      if (error) throw error;
      const userIds = [...new Set((data || []).map((d: any) => d.user_id))];
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', userIds);
      const map = new Map((profiles || []).map((p: any) => [p.id, p]));
      return (data || []).map((it: any) => ({ ...it, profile: map.get(it.user_id) }));
    },
  });

  const createRun = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('payroll_create_run', {
        p_branch_id: branchId || null,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success('Payroll calculated — review items');
      setSelectedRunId(id);
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const reviewMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('payroll_review_items', { p_item_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Marked reviewed'); setSelectedIds([]); qc.invalidateQueries({ queryKey: ['payroll-items'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const approveMut = useMutation({
    mutationFn: async () => {
      if (!activeRunId) return;
      const { error } = await supabase.rpc('payroll_approve_run', { p_run_id: activeRunId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Run approved'); qc.invalidateQueries({ queryKey: ['payroll-items'] }); qc.invalidateQueries({ queryKey: ['payroll-runs'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const processMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('payroll_process_items', { p_item_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Processed'); setSelectedIds([]); qc.invalidateQueries({ queryKey: ['payroll-items'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  // Pending salary advance for the staff member being adjusted — so payroll
  // can recover it in this run instead of tracking it on paper.
  const { data: pendingAdvance = 0 } = useQuery({
    queryKey: ['pending-advance', adjustItem?.user_id],
    queryFn: () => pendingAdvanceForUser(adjustItem.user_id),
    enabled: !!adjustItem?.user_id,
  });

  const payMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('payroll_mark_paid', {
        p_item_ids: selectedIds, p_method: payMethod, p_reference: payRef || null,
      });
      if (error) throw error;

      // Close out the advance ledger for every staff member whose payslip
      // deducted an advance in this batch.
      const paidItems = items.filter((i: any) => selectedIds.includes(i.id) && Number(i.final_advance) > 0);
      for (const item of paidItems) {
        try {
          await applyAdvanceRecovery(item.user_id, Number(item.final_advance));
        } catch (e) {
          console.warn('[payroll] advance recovery failed', item.user_id, e);
        }
      }
    },
    onSuccess: () => {
      toast.success('Marked paid');
      setSelectedIds([]); setPayOpen(false); setPayRef('');
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
      qc.invalidateQueries({ queryKey: ['salary-advances'] });
      qc.invalidateQueries({ queryKey: ['pending-advance'] });
      qc.invalidateQueries({ queryKey: ['pt-commission-ledger'] });

    },
    onError: (e: any) => toast.error(e.message),
  });

  const adjustMut = useMutation({
    mutationFn: async () => {
      if (!adjustItem) return;
      const patch = {
        final_base: Number(adjustItem.final_base) || 0,
        final_pt_commission: Number(adjustItem.final_pt_commission) || 0,
        final_ot: Number(adjustItem.final_ot) || 0,
        final_bonus: Number(adjustItem.final_bonus) || 0,
        final_deductions: Number(adjustItem.final_deductions) || 0,
        final_advance: Number(adjustItem.final_advance) || 0,
        final_penalty: Number(adjustItem.final_penalty) || 0,
      };
      const { error } = await supabase.rpc('payroll_adjust_item', {
        p_item_id: adjustItem.id, p_patch: patch as any, p_reason: adjustReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Adjustment saved');
      setAdjustItem(null); setAdjustReason('');
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleId = (id: string) => setSelectedIds((s) => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = (status: Status) => {
    const ids = items.filter((i: any) => i.status === status).map((i: any) => i.id);
    setSelectedIds((s) => s.length === ids.length ? [] : ids);
  };

  const activeRun = runs.find((r: any) => r.id === activeRunId);

  return (
    <Card className="rounded-2xl shadow-lg shadow/50">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Payroll Run — {periodStart} → {periodEnd}</CardTitle>
          {activeRun && (
            <p className="text-xs text-muted-foreground mt-1">
              Run status: <Badge className={STATUS_BADGE[(activeRun.status as Status) || 'draft']}>{activeRun.status}</Badge>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => createRun.mutate()} disabled={createRun.isPending} variant="default">
            {createRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />}
            Calculate Run
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No items — click <strong>Calculate Run</strong> to generate payroll items.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-3">
              <Button size="sm" variant="outline" onClick={() => toggleAll('draft')}>Select Draft</Button>
              <Button size="sm" variant="outline" onClick={() => toggleAll('reviewed')}>Select Reviewed</Button>
              <Button size="sm" variant="outline" onClick={() => toggleAll('approved')}>Select Approved</Button>
              <div className="flex-1" />
              <Button size="sm" disabled={selectedIds.length === 0 || reviewMut.isPending}
                onClick={() => reviewMut.mutate(selectedIds)}>
                <ClipboardCheck className="h-4 w-4 mr-1" /> Mark Reviewed
              </Button>
              <Button size="sm" variant="default" disabled={!activeRunId || approveMut.isPending}
                onClick={() => approveMut.mutate()}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve Run
              </Button>
              <Button size="sm" disabled={selectedIds.length === 0 || processMut.isPending}
                onClick={() => processMut.mutate(selectedIds)}>
                <Send className="h-4 w-4 mr-1" /> Process Selected
              </Button>
              <Button size="sm" variant="secondary" disabled={selectedIds.length === 0}
                onClick={() => setPayOpen(true)}>
                <Banknote className="h-4 w-4 mr-1" /> Mark Paid
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Base</TableHead>
                    <TableHead className="text-right">PT</TableHead>
                    <TableHead className="text-right">Bonus</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Adj.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it: any) => {
                    const adjusted = Number(it.final_net) !== Number(it.calc_net);
                    return (
                      <TableRow key={it.id}>
                        <TableCell>
                          <Checkbox checked={selectedIds.includes(it.id)} onCheckedChange={() => toggleId(it.id)} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{it.profile?.full_name || it.user_id.slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">{it.staff_kind}</div>
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_BADGE[(it.status as Status) || 'draft']}>{it.status}</Badge>
                          {adjusted && <Badge variant="outline" className="ml-1 text-[10px]">adjusted</Badge>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">₹{Number(it.final_base).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">₹{Number(it.final_pt_commission).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">₹{Number(it.final_bonus).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-destructive">
                          -₹{(Number(it.final_deductions) + Number(it.final_advance) + Number(it.final_penalty)).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-bold">₹{Number(it.final_net).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="ghost"
                            disabled={['processed','paid'].includes(it.status)}
                            onClick={() => setAdjustItem({ ...it })}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      {/* Adjustment dialog */}
      <Dialog open={!!adjustItem} onOpenChange={(o) => { if (!o) { setAdjustItem(null); setAdjustReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Payroll — {adjustItem?.profile?.full_name}</DialogTitle>
            <DialogDescription>
              Calculated net was <strong>₹{Number(adjustItem?.calc_net || 0).toLocaleString()}</strong>. Provide a reason for any change.
            </DialogDescription>
          </DialogHeader>
          {adjustItem && (
            <div className="grid grid-cols-2 gap-3">
              {pendingAdvance > 0 && (
                <div className="col-span-2 flex items-center justify-between gap-3 rounded-xl bg-warning/10 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-warning">
                    <HandCoins className="h-4 w-4" />
                    <span>Outstanding salary advance: <strong>₹{pendingAdvance.toLocaleString('en-IN')}</strong></span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    onClick={() => setAdjustItem({ ...adjustItem, final_advance: pendingAdvance })}
                  >
                    Recover in this run
                  </Button>
                </div>
              )}
              {[
                ['final_base', 'Base'],
                ['final_pt_commission', 'PT Commission'],
                ['final_ot', 'Overtime'],
                ['final_bonus', 'Bonus'],
                ['final_deductions', 'Deductions'],
                ['final_advance', 'Advance'],
                ['final_penalty', 'Penalty'],
              ].map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <Input
                    type="number"
                    value={adjustItem[k] ?? 0}
                    onChange={(e) => setAdjustItem({ ...adjustItem, [k]: e.target.value })}
                  />
                </div>
              ))}
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
                <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Required for audit" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustItem(null)}>Cancel</Button>
            <Button onClick={() => adjustMut.mutate()} disabled={!adjustReason.trim() || adjustMut.isPending}>
              {adjustMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark {selectedIds.length} item(s) as Paid</DialogTitle>
            <DialogDescription>Only items currently in <strong>processed</strong> status will be marked paid.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Payment Method</Label>
              <Input value={payMethod} onChange={(e) => setPayMethod(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Reference</Label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="UTR / Cheque / Txn ID" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button onClick={() => payMut.mutate()} disabled={payMut.isPending}>
              {payMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
