import { useState } from 'react';
import { PayrollItemDetailsDrawer } from './PayrollItemDetailsDrawer';
import { attendanceValues, type PayrollItem } from '@/lib/hrm/payroll';
import { can } from '@/lib/auth/permissions';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

import { ClipboardCheck, CheckCircle2, Send, Banknote, PlusCircle, Loader2, Pencil, HandCoins, Eye, RefreshCw, RotateCcw, Download } from 'lucide-react';
import { exportToCSV } from '@/lib/csvExport';




import { useAuth } from '@/contexts/AuthContext';

type Status = 'calculated' | 'draft' | 'reviewed' | 'approved' | 'processed' | 'paid';

const STATUS_BADGE: Record<Status, string> = {
  calculated: 'bg-muted text-foreground',
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
  const { hasAnyRole, roles } = useAuth();
  const isAdmin = hasAnyRole(['admin', 'owner', 'manager']);
  
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');


  const { data: runs = [], isLoading: runsLoading, isError: runsError, refetch: retryRuns } = useQuery({
    queryKey: ['payroll-runs', branchId, periodStart, periodEnd],
    queryFn: async () => {
      let q = supabase.from('payroll_runs').select('*')
        .eq('period_start', periodStart)
        .order('created_at', { ascending: false });
      if (branchId) q = q.eq('branch_id', branchId); else q = q.is('branch_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const activeRunId = (runs.some(r=>r.id===selectedRunId) ? selectedRunId : runs[0]?.id) || null;

  const { data: items = [], isLoading: itemsLoading, isError: itemsError, refetch: retryItems } = useQuery({
    queryKey: ['payroll-items', activeRunId],
    enabled: !!activeRunId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_items')
        .select('*')
        .eq('run_id', activeRunId);
      if (error) throw error;
      const userIds = [...new Set((data || []).map(d => d.user_id))];
      const { data: profiles, error: profileError } = await supabase.from('profiles').select('id, full_name, email').in('id', userIds);
      if(profileError) throw profileError;
      const map = new Map((profiles || []).map(p => [p.id, p]));
      return (data || []).map(it => ({ ...it, profile: map.get(it.user_id) }));
    },
  });

  const {data: banks = [], isError: banksError, isLoading: banksLoading} = useQuery({queryKey:['payroll-banks',activeRunId], enabled:!!activeRunId && items.length>0, queryFn:async()=>{const ids=items.map(i=>i.user_id);const [e,t]=await Promise.all([supabase.from('employees').select('user_id,bank_name,bank_account,bank_ifsc').in('user_id',ids),supabase.from('trainers').select('user_id,bank_name,bank_account,bank_ifsc').in('user_id',ids)]);if(e.error)throw e.error;if(t.error)throw t.error;return [...(e.data || []),...(t.data || [])];}});
  const correctPeriod = useMutation({mutationFn:async()=>{if(!activeRunId)return;const {error}=await supabase.rpc('payroll_correct_period',{p_run_id:activeRunId,p_end:periodEnd,p_reason:'Correct October month-end timezone error; preserve recorded payments and manual adjustments'});if(error)throw error;},onSuccess:()=>{toast.success('Period corrected; paid salaries preserved');qc.invalidateQueries({queryKey:['payroll-runs']});qc.invalidateQueries({queryKey:['payroll-items']});},onError:(e:Error)=>toast.error(e.message)});

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
      qc.invalidateQueries({ queryKey: ['payroll-items'] });
    },
    onError: (e: Error) => toast.error(e.message),
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
    onError: (e: Error) => toast.error(e.message),
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
    onError: (e: Error) => toast.error(e.message),
  });


  const toggleId = (id: string) => setSelectedIds((s) => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const toggleAll = (status: Status) => {
    const ids = items.filter((i) => i.status === status).map((i) => i.id);
    setSelectedIds((s) => s.length === ids.length ? [] : ids);
  };

  const activeRun = runs.find((r) => r.id === activeRunId);

  const att = (it: PayrollItem) => attendanceValues(it);
  const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  const totals = items.reduce(
    (acc, it) => {
      acc.base += Number(it.final_base || 0);
      acc.pt += Number(it.final_pt_commission || 0);
      acc.ot += Number(it.final_ot || 0);
      acc.bonus += Number(it.final_bonus || 0);
      acc.advance += Number(it.final_advance || 0);
      acc.deductions += Number(it.final_deductions || 0) + Number(it.final_penalty || 0);
      acc.net += Number(it.final_net || 0);
      return acc;
    },
    { base: 0, pt: 0, ot: 0, bonus: 0, advance: 0, deductions: 0, net: 0 },
  );

  const exportCsv = () => {
    const rows = items.map((it) => {
      const a = att(it);
      return {
        Employee: it.profile?.full_name || it.user_id,
        Kind: it.staff_kind,
        'Month Days': a.total_days ?? '',
        'Total Shifts': a.shifts_rostered ?? '',
        'Missed Shifts': a.shifts_missed ?? '',
        'Attended Shifts': a.shifts_attended ?? '',
        'Payable Days': a.payable_days ?? '',
        'Per Shift Rate': a.per_shift_rate ?? '',
        'Base Salary': a.monthly_salary ?? '',
        'Salary Earned': Number(it.final_base || 0),
        'PT Commission': Number(it.final_pt_commission || 0),
        'OT Hours': a.ot_hours ?? '',
        'Overtime Pay': Number(it.final_ot || 0),
        Bonus: Number(it.final_bonus || 0),
        Deductions: Number(it.final_deductions || 0) + Number(it.final_penalty || 0),
        Advance: Number(it.final_advance || 0),
        'Net Payout': Number(it.final_net || 0),
        Status: it.status,
        'Payment method': it.payment_method,
        Reference: it.payment_reference,
        'Snapshot end': it.snapshot_period_end,
        'Adjustment reason': it.adjustment_reason,
      };
    });
    exportToCSV(rows, `payroll-${periodStart}-to-${periodEnd}`);
  };

  const exportRemittance=(method:string)=>{
    const eligible=items.filter(i=>i.status==='processed' && i.payment_method===method);
    if(!eligible.length){toast.error('No processed salaries for this payment method');return;}
    const rows=eligible.map(i=>{const bank=banks.find(b=>b.user_id===i.user_id && b.bank_account) || banks.find(b=>b.user_id===i.user_id);return {Beneficiary:i.profile?.full_name,'Bank account':bank?.bank_account || '',IFSC:bank?.bank_ifsc || '',Bank:bank?.bank_name || '',Amount:Number(i.final_net),'Salary month':periodStart.slice(0,7),Status:i.status,Reference:i.payment_reference || '',Signature:method==='cash'?'________________':'', 'Payment date':i.status==='paid'?i.updated_at:''};});
    if(method==='bank_transfer' && rows.some(r=>!r['Bank account'] || !r.IFSC)){toast.error('Bank details are missing; complete them in Salary details');return;}
    exportToCSV(rows,`payroll-${method}-${periodStart}`);
  };


  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Payroll Run — {periodStart} → {periodEnd}</CardTitle>
          {activeRun && (
            <p className="text-xs text-muted-foreground mt-1">
              Run status: <Badge className={STATUS_BADGE[(activeRun.status as Status) || 'draft']}>{activeRun.status}</Badge>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeRun && !['processed', 'paid'].includes(activeRun.status) && activeRun.status !== 'draft'
            && hasAnyRole(['owner', 'admin']) && (
            <Button variant="outline" onClick={() => setReopenOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-2" /> Reopen Run
            </Button>
          )}
          <Button onClick={() => createRun.mutate()} disabled={createRun.isPending || !!activeRunId || runsLoading || !can.manageStaff(roles)} variant="default">
            {createRun.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PlusCircle className="h-4 w-4 mr-2" />}
            {activeRunId ? 'Saved run' : 'Calculate Run'}
          </Button>
        </div>

      </CardHeader>
      <CardContent>
        {runs.length>1 && <div className="mb-4"><Label htmlFor="saved-run">Saved payroll run</Label><Select value={activeRunId || ''} onValueChange={id=>{setSelectedRunId(id);setSelectedIds([]);}}><SelectTrigger id="saved-run"><SelectValue/></SelectTrigger><SelectContent>{runs.map(r=><SelectItem key={r.id} value={r.id}>{new Date(r.created_at).toLocaleString('en-IN')} · {r.period_end} · {r.status}</SelectItem>)}</SelectContent></Select></div>}
        {activeRun && activeRun.period_end!==periodEnd && <div className="mb-4 bg-warning/10 rounded-xl p-4 text-sm flex flex-wrap items-center gap-3"><span>Saved run ends {activeRun.period_end}; calendar month ends {periodEnd}. Paid salaries will stay unchanged.</span><Button variant="outline" disabled={correctPeriod.isPending || !can.manageStaff(roles)} onClick={()=>correctPeriod.mutate()}>Correct month end</Button></div>}
        {(runsLoading || itemsLoading) ? <Skeleton className="h-40"/> : (runsError || itemsError) ? <Button variant="outline" onClick={()=>{retryRuns();retryItems();}}>Retry payroll</Button> :

        items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No items — click <strong>Calculate Run</strong> to generate payroll items.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-3">



              <div className="flex-1" />
              <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-4 w-4 mr-1"/>Full ledger</Button>
              <Button size="sm" variant="outline" disabled={banksError || banksLoading} onClick={()=>exportRemittance('bank_transfer')}><Download className="h-4 w-4 mr-1"/>Bank remittance</Button>
              <Button size="sm" variant="outline" onClick={()=>exportRemittance('cash')}><Download className="h-4 w-4 mr-1"/>Cash payout</Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Shifts</TableHead>
                    <TableHead className="text-right">Payable days</TableHead>
                    <TableHead className="text-right">Salary earned</TableHead>
                    <TableHead className="text-right">PT</TableHead>
                    <TableHead className="text-right">Overtime</TableHead>
                    <TableHead className="text-right">Bonus</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Advance</TableHead>
                    <TableHead className="text-right">Net payout</TableHead>
                    <TableHead className="text-right">Adj.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => {
                    const adjusted = Number(it.final_net) !== Number(it.calc_net);
                    const a = att(it);
                    return (
                      <TableRow key={it.id}>
                        <TableCell>
                          <Checkbox aria-label={`Select ${it.profile?.full_name || 'staff'}`} checked={selectedIds.includes(it.id)} onCheckedChange={() => toggleId(it.id)} />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm">{it.profile?.full_name || it.user_id.slice(0, 8)}</div>
                          <div className="text-xs text-muted-foreground">
                            {it.staff_kind}
                            {a.monthly_salary ? ` · ${inr(Number(a.monthly_salary))}/mo` : ''}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_BADGE[(it.status as Status) || 'draft']}>{it.status}</Badge>
                          {adjusted && <Badge variant="outline" className="ml-1 text-[10px]">adjusted</Badge>}
                          {it.attendance_changed_at && (
                            <Badge className="ml-1 bg-warning/15 text-warning text-[10px]">attendance changed</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          <span className="font-mono">{a.shifts_attended ?? 0}/{a.shifts_rostered ?? 0}</span>
                          {Number(a.shifts_missed || 0) > 0 && (
                            <div className="text-[11px] text-destructive">{a.shifts_missed} missed</div>
                          )}
                          {Number(a.per_shift_rate || 0) > 0 && (
                            <div className="text-[11px] text-muted-foreground">{inr(Number(a.per_shift_rate))}/shift</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {a.payable_days ?? 0}<span className="text-muted-foreground">/{a.total_days ?? 0}</span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{inr(Number(it.final_base))}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{inr(Number(it.final_pt_commission))}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{inr(Number(it.final_ot))}{Number(att(it).ot_hours) > 0 && <div className="text-[10px] text-muted-foreground">{att(it).ot_hours}h</div>}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{inr(Number(it.final_bonus))}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-destructive">
                          {Number(it.final_deductions) + Number(it.final_penalty) > 0
                            ? `-${inr(Number(it.final_deductions) + Number(it.final_penalty))}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-destructive">
                          {Number(it.final_advance) > 0 ? `-${inr(Number(it.final_advance))}` : '—'}
                        </TableCell>
                        <TableCell className="text-right font-bold">{inr(Number(it.final_net))}</TableCell>

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
                            <Button size="sm" variant="outline" className="min-h-11" onClick={()=>{setDetailId(it.id);setDetailOpen(true);}}><Eye className="h-4 w-4 mr-1"/>Salary details</Button>
                          </div>
                        </TableCell>

                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-muted font-semibold">
                    <TableCell colSpan={5} className="text-right text-xs uppercase tracking-wider text-muted-foreground">Total</TableCell>
                    <TableCell className="text-right font-mono text-sm">{inr(totals.base)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{inr(totals.pt)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{inr(totals.ot)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{inr(totals.bonus)}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-destructive">
                      {totals.deductions > 0 ? `-${inr(totals.deductions)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-destructive">
                      {totals.advance > 0 ? `-${inr(totals.advance)}` : '—'}
                    </TableCell>
                    <TableCell className="text-right font-bold">{inr(totals.net)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>

            </div>
          </>
        )}
      </CardContent>

      <PayrollItemDetailsDrawer open={detailOpen} onOpenChange={setDetailOpen} item={items.find(i=>i.id===detailId) || null} periodStart={periodStart} periodEnd={activeRun?.period_end || periodEnd} branchId={branchId}/>

      {/* Reopen Drawer */}
      <Sheet open={reopenOpen} onOpenChange={setReopenOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Reopen payroll run</SheetTitle>
            <SheetDescription>
              The run returns to <strong>draft</strong> so attendance corrections can be recalculated.
              Approvals are cleared and the change is recorded in the payroll audit trail.
              Processed or paid runs can never be reopened.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-2 py-6">
            <Label htmlFor="reopen-reason">Reason</Label>
            <Input id="reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)}
              placeholder="e.g. night-shift attendance corrected after approval" />
          </div>
          <SheetFooter className="mt-auto pt-4 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setReopenOpen(false)}>Cancel</Button>
            <Button className="flex-1" disabled={!reopenReason.trim() || reopenMut.isPending}
              onClick={() => reopenMut.mutate()}>
              {reopenMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reopen as draft
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

    </Card>
  );
}
