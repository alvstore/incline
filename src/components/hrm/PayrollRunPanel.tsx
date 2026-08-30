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
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
} from '@/components/ui/sheet';
import { toast } from 'sonner';
import { pendingAdvanceForUser, applyAdvanceRecovery } from '@/services/expenseService';
import { ClipboardCheck, CheckCircle2, Send, Banknote, PlusCircle, Loader2, Pencil, HandCoins, Eye } from 'lucide-react';
import { PayrollAdjustmentDrawer } from './PayrollAdjustmentDrawer';
import { PayrollProcessPreviewDrawer } from './PayrollProcessPreviewDrawer';
import { useAuth } from '@/contexts/AuthContext';

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
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(['admin', 'owner', 'manager']);
  
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [adjustItem, setAdjustItem] = useState<any | null>(null);
  const [adjustDrawerOpen, setAdjustDrawerOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<any | null>(null);
  const [previewDrawerOpen, setPreviewDrawerOpen] = useState(false);
  
  const [payMethod, setPayMethod] = useState('bank_transfer');
  const [payRef, setPayRef] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');


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

  // Attendance corrections flag payroll lines as stale; HR recalculates deliberately.
  const recalcMut = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.rpc('payroll_recalculate_item', {
        p_item_id: itemId, p_reason: 'attendance corrected',
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Recalculated from attendance'); qc.invalidateQueries({ queryKey: ['payroll-items'] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const reopenMut = useMutation({
    mutationFn: async () => {
      if (!activeRunId) return;
      const { error } = await supabase.rpc('payroll_reopen_run', {
        p_run_id: activeRunId, p_reason: reopenReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Run reopened as draft');
      setReopenOpen(false); setReopenReason('');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
    },
    onError: (e: any) => toast.error(e.message),
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

  // Removed adjustMut since it's now handled inside PayrollAdjustmentDrawer


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
                          {it.attendance_changed_at && (
                            <Badge className="ml-1 bg-warning/15 text-warning text-[10px]">attendance changed</Badge>
                          )}
                        </TableCell>

                        <TableCell className="text-right font-mono text-sm">₹{Number(it.final_base).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">₹{Number(it.final_pt_commission).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm">₹{Number(it.final_bonus).toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-destructive">
                          -₹{(Number(it.final_deductions) + Number(it.final_advance) + Number(it.final_penalty)).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-bold">₹{Number(it.final_net).toLocaleString()}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1 justify-end">
                            {it.attendance_changed_at && (
                              <Button size="sm" variant="ghost" aria-label="Recalculate from attendance"
                                disabled={['processed','paid'].includes(it.status) || !isAdmin || recalcMut.isPending}
                                onClick={() => recalcMut.mutate(it.id)}
                                className="text-warning hover:bg-warning/10"
                              >
                                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Recalculate
                              </Button>
                            )}
                            <Button size="sm" variant="ghost"
                              disabled={['processed','paid'].includes(it.status)}
                              onClick={() => { setPreviewItem(it); setPreviewDrawerOpen(true); }}
                              className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> Preview
                            </Button>
                            <Button size="sm" variant="ghost" aria-label="Adjust payroll item"
                              disabled={['processed','paid'].includes(it.status) || !isAdmin}
                              onClick={() => { setAdjustItem(it); setAdjustDrawerOpen(true); }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </div>
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

      <PayrollAdjustmentDrawer 
        open={adjustDrawerOpen} 
        onOpenChange={setAdjustDrawerOpen} 
        item={adjustItem} 
      />

      <PayrollProcessPreviewDrawer
        open={previewDrawerOpen}
        onOpenChange={setPreviewDrawerOpen}
        item={previewItem}
      />

      {/* Pay Drawer */}
      <Sheet open={payOpen} onOpenChange={setPayOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Mark {selectedIds.length} item(s) as Paid</SheetTitle>
            <SheetDescription>Only items currently in <strong>processed</strong> status will be marked paid.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-6">
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Input value={payMethod} onChange={(e) => setPayMethod(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Reference</Label>
              <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="UTR / Cheque / Txn ID" />
            </div>
          </div>
          <SheetFooter className="mt-auto pt-4 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setPayOpen(false)}>Cancel</Button>
            <Button className="flex-1" onClick={() => payMut.mutate()} disabled={payMut.isPending}>
              {payMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Paid
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
