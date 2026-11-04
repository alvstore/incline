import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { can, canManageHrRow } from '@/lib/auth/permissions';
import { attendanceValues, payrollNet, type PayrollItem } from '@/lib/hrm/payroll';
import { exportToCSV } from '@/lib/csvExport';

const money = (value: number) => `₹${value.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
const fields = ['final_base','final_ot','final_bonus','final_deductions','final_advance','final_penalty'] as const;
type Field = typeof fields[number];
const labels: Record<Field,string> = {final_base:'Salary earned',final_ot:'Overtime pay',final_bonus:'Bonus / extra commission',final_deductions:'Statutory deductions',final_advance:'Advance / store recovery',final_penalty:'Other deduction'};
type PtRow = {installment_id:string; amount:number; member_name:string; payout_month:string; settled:boolean};
type Bank = {bank_name:string; bank_account:string; bank_ifsc:string};

export function PayrollItemDetailsDrawer({open,onOpenChange,item,periodStart,periodEnd,branchId}: {open:boolean;onOpenChange:(open:boolean)=>void;item:PayrollItem|null;periodStart:string;periodEnd:string;branchId?:string|null}) {
  const qc=useQueryClient();
  const {roles,user}=useAuth();
  const [values,setValues]=useState<Record<Field,number>>({final_base:0,final_ot:0,final_bonus:0,final_deductions:0,final_advance:0,final_penalty:0});
  const [selected,setSelected]=useState<string[]>([]);
  const [reason,setReason]=useState('');
  const [method,setMethod]=useState('bank_transfer');
  const [reference,setReference]=useState('');
  const [bank,setBank]=useState<Bank>({bank_name:'',bank_account:'',bank_ifsc:''});
  const paid=item?.status==='paid';
  const processed=item?.status==='processed';
  const canEdit=canManageHrRow(roles,item?.user_id,user?.id) && !paid && !processed;
  const canProcess=can.manageStaff(roles);
  const {data:pt=[],isLoading:ptLoading,isError:ptError,refetch:retryPt}=useQuery({
    queryKey:['pt_settlements',item?.id],enabled:open && !!item,
    queryFn:async()=>{if(!item)return [];const {data,error}=await supabase.rpc('payroll_item_pt_breakdown',{p_item_id:item.id});if(error)throw error;return (data || []).map(r=>({...r,amount:Number(r.amount)})) as PtRow[];},
  });
  const {data:bankData,isLoading:bankLoading,isError:bankError}=useQuery({
    queryKey:['payroll-bank',item?.user_id,item?.staff_kind],enabled:open && !!item,
    queryFn:async()=>{if(!item)return null;const {data,error}=await supabase.from(item.staff_kind==='trainer'?'trainers':'employees').select('bank_name,bank_account,bank_ifsc').eq('user_id',item.user_id).maybeSingle();if(error)throw error;return data;},
  });
  const {data:current,isLoading:currentLoading,isError:currentError}=useQuery({
    queryKey:['payroll-calculation',item?.id,periodEnd],enabled:open && !!item,
    queryFn:async()=>{if(!item)return null;const {data,error}=await supabase.rpc('payroll_calculation',{p_user_id:item.user_id,p_branch_id:branchId || null,p_start:periodStart,p_end:periodEnd});if(error)throw error;return data as {base:number;advance:number;attendance:Record<string,number>};},
  });
  const {data:history=[],isError:historyError}=useQuery({
    queryKey:['payroll-audit',item?.id],enabled:open && !!item,
    queryFn:async()=>{if(!item)return [];const {data,error}=await supabase.from('payroll_audit').select('id,action,reason,created_at').eq('item_id',item.id).order('created_at',{ascending:false}).limit(30);if(error)throw error;return data || [];},
  });
  useEffect(()=>{if(!item)return;setValues(Object.fromEntries(fields.map(f=>[f,Number(item[f] || 0)])) as Record<Field,number>);setReason('');setMethod(item.payment_method || 'bank_transfer');setReference(item.payment_reference || '');},[item,open]);
  useEffect(()=>{setSelected(processed ? item?.prepared_installment_ids || [] : pt.filter(r=>paid ? r.settled : !r.settled).map(r=>r.installment_id));},[pt,processed,paid,item?.prepared_installment_ids]);
  useEffect(()=>{setBank({bank_name:bankData?.bank_name || '',bank_account:bankData?.bank_account || '',bank_ifsc:bankData?.bank_ifsc || ''});},[bankData]);
  const changed=!!item && fields.some(f=>values[f]!==Number(item[f] || 0));
  const ptTotal=paid || processed ? Number(item?.final_pt_commission || 0) : pt.filter(r=>selected.includes(r.installment_id)).reduce((s,r)=>s+r.amount,0);
  const net=paid ? Number(item?.final_net || 0) : payrollNet({base:values.final_base,pt:ptTotal,ot:values.final_ot,bonus:values.final_bonus,deductions:values.final_deductions,advance:values.final_advance,penalty:values.final_penalty});
  const invalid=fields.some(f=>!Number.isFinite(values[f]) || values[f]<0) || net<0 || (changed && !reason.trim());
  const bankInvalid=method==='bank_transfer' && (!/^\d{6,24}$/.test(bank.bank_account) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.bank_ifsc));
  const stale=!!item && (!!item.attendance_changed_at || item.snapshot_period_end!==periodEnd);
  const mutation=useMutation({
    mutationFn:async(action:'save'|'process'|'pay'|'recalculate')=>{
      if(!item)throw new Error('Select a salary');
      if(action==='recalculate'){const {error}=await supabase.rpc('payroll_recalculate_item',{p_item_id:item.id,p_reason:'Attendance and overtime policy reviewed'});if(error)throw error;}
      if(action==='save'){const {error}=await supabase.rpc('payroll_adjust_item',{p_item_id:item.id,p_patch:values,p_reason:reason});if(error)throw error;}
      if(action==='process'){const {error}=await supabase.rpc('payroll_prepare_item',{p_item_id:item.id,p_installment_ids:selected,p_patch:values,p_reason:reason || 'Salary reviewed for processing',p_method:method,p_bank:bank});if(error)throw error;}
      if(action==='pay'){const {error}=await supabase.rpc('payroll_settle_item',{p_item_id:item.id,p_installment_ids:item.prepared_installment_ids || [],p_adjustment:0,p_reason:'Payment recorded after salary processing',p_method:method,p_reference:reference || ''});if(error)throw error;}
      return action;
    },
    onSuccess:action=>{toast.success(action==='pay'?'Salary payment recorded':action==='process'?'Salary processed — ready for remittance':action==='save'?'Salary adjustments saved':'Salary recalculated; manual adjustments preserved');['payroll-items','payroll-runs','payroll-audit','payroll-calculation','payroll-bank','pt_settlements','salary-advances','pending-advance'].forEach(k=>qc.invalidateQueries({queryKey:[k]}));},
    onError:(e:Error)=>toast.error(e.message),
  });
  const a=item?attendanceValues(item):{};
  const download=()=>{if(!item)return;exportToCSV([{Staff:item.profile?.full_name,Period:`${periodStart} to ${item.snapshot_period_end || periodEnd}`,Status:item.status,'Payable days':a.payable_days,'Month days':a.total_days,'Half days':a.half_day,'Monthly salary':a.monthly_salary,'Salary earned':item.final_base,'PT commission':item.final_pt_commission,Overtime:item.final_ot,Bonus:item.final_bonus,Deductions:item.final_deductions,Advance:item.final_advance,Penalty:item.final_penalty,'Net payout':item.final_net,Method:item.payment_method,Reference:item.payment_reference,Reason:item.adjustment_reason}],`salary-${item.profile?.full_name || item.id}`);};
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh]">
    <SheetHeader className="px-6 py-5 border-b border-border shrink-0"><SheetTitle>Salary — {item?.profile?.full_name || 'Staff'}</SheetTitle><SheetDescription>{periodStart} to {periodEnd} · <Badge variant="outline">{item?.status}</Badge></SheetDescription></SheetHeader>
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      <section className="space-y-2"><h3 className="font-semibold">Attendance & salary</h3><div className="grid grid-cols-2 gap-3 text-sm"><div>Payable days <strong>{a.payable_days ?? 0} / {a.total_days ?? 0}</strong></div><div>Half days <strong>{a.half_day ?? 0}</strong></div><div>Shifts <strong>{a.shifts_attended ?? 0} / {a.shifts_rostered ?? 0}</strong></div><div>Monthly salary <strong>{money(a.monthly_salary || 0)}</strong></div></div><p className="text-sm text-muted-foreground">{money(a.monthly_salary || 0)} / {a.total_days || 0} days × {a.payable_days || 0} payable days = {money(Number(item?.calc_base || 0))}</p>
      {paid && <div className="bg-muted p-3 rounded-xl text-sm">Paid snapshot preserved through {item?.snapshot_period_end}. {currentLoading?'Checking corrected attendance…':currentError?'Corrected attendance unavailable.':`Current full-month attendance: ${current?.attendance.payable_days ?? 0} / ${current?.attendance.total_days ?? 0} payable days; calculated base ${money(Number(current?.base || 0))}.`} Saved payment: {money(Number(item?.final_net || 0))}.</div>}
      {stale && !paid && <p role="alert" className="text-warning text-sm">Attendance or payroll period changed. Recalculate before processing.</p>}
      {canEdit && <Button variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={()=>mutation.mutate('recalculate')}><RefreshCw className="h-4 w-4 mr-2"/>Recalculate attendance</Button>}
      </section>
      <section className="space-y-3"><h3 className="font-semibold">Earnings & deductions</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{fields.map(f=><div key={f}><Label htmlFor={f}>{labels[f]}</Label><Input id={f} type="number" inputMode="decimal" min="0" step="0.01" value={values[f]} disabled={!canEdit} onChange={e=>setValues(v=>({...v,[f]:Number(e.target.value)}))}/></div>)}</div><p className="text-xs text-muted-foreground">Saved overtime: {a.ot_hours || 0}h × {money(a.ot_hourly_rate || 0)} × {a.ot_multiplier || 0}. Advance recovery is saved for this pay cycle, not today’s outstanding balance.</p>{canEdit && <div><Label htmlFor="salary-reason">Adjustment reason{changed?' *':''}</Label><Input id="salary-reason" value={reason} onChange={e=>setReason(e.target.value)} aria-required={changed}/></div>}{item?.adjustment_reason && <p className="text-sm text-muted-foreground">Saved reason: {item.adjustment_reason}</p>}</section>
      <section className="space-y-3"><h3 className="font-semibold">PT commission · {money(ptTotal)}</h3>{ptLoading?<Skeleton className="h-24"/>:ptError?<Button variant="outline" onClick={()=>retryPt()}>Retry PT entries</Button>:pt.length===0?<p className="text-sm text-muted-foreground">No eligible PT entries for this salary.</p>:<div className="max-h-64 overflow-y-auto divide-y divide-border">{pt.map(r=><label key={r.installment_id} className="flex min-h-11 items-center gap-3 py-3"><Checkbox checked={selected.includes(r.installment_id)} disabled={!canEdit || r.settled} aria-label={`Include ${r.member_name}`} onCheckedChange={v=>setSelected(s=>v?[...s,r.installment_id]:s.filter(id=>id!==r.installment_id))}/><span className="flex-1 text-sm">{r.member_name}<span className="block text-muted-foreground text-xs">{r.payout_month}</span></span><span className="text-sm tabular-nums">{money(r.amount)}{r.settled?' · paid':''}</span></label>)}</div>}</section>
      <section className="space-y-4"><h3 className="font-semibold">Remittance</h3><Label htmlFor="salary-method">Payment method</Label><Select value={method} onValueChange={setMethod} disabled={paid || processed}><SelectTrigger id="salary-method"><SelectValue/></SelectTrigger><SelectContent>{['bank_transfer','cash','upi','cheque'].map(m=><SelectItem key={m} value={m}>{m.replace('_',' ')}</SelectItem>)}</SelectContent></Select>
      {method==='bank_transfer' && <>{bankLoading?<Skeleton className="h-24"/>:bankError?<p role="alert">Bank details could not be loaded.</p>:<div className="space-y-3">{(['bank_name','bank_account','bank_ifsc'] as const).map(k=><div key={k}><Label htmlFor={k}>{k.replace('bank_','Bank ')}</Label><Input id={k} value={bank[k]} disabled={!canEdit} onChange={e=>setBank(b=>({...b,[k]:k==='bank_ifsc'?e.target.value.toUpperCase():e.target.value}))}/>)}</div>}{bankInvalid && !paid && <p className="text-sm text-destructive">Enter a valid account number and IFSC before bank remittance.</p>}</>}
      {(processed || paid) && <div><Label htmlFor="salary-reference">Payment reference / UTR</Label><Input id="salary-reference" disabled={paid} value={reference} onChange={e=>setReference(e.target.value)}/></div>}</section>
      <section className="space-y-2"><h3 className="font-semibold">Salary history</h3>{historyError?<p className="text-sm text-destructive">Salary history unavailable.</p>:history.map(h=><div key={h.id} className="text-xs border-b border-border py-2"><span className="font-medium">{h.action.replaceAll('_',' ')}</span> · {new Date(h.created_at).toLocaleString('en-IN')} {h.reason && <p className="text-muted-foreground">{h.reason}</p>}</div>)}</section>
    </div>
    <div className="border-t border-border px-6 py-4 pb-safe space-y-3 bg-card shrink-0"><div className="flex justify-between items-center" aria-live="polite"><span>Net payout</span><strong className="text-2xl tabular-nums">{money(net)}</strong></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={download} disabled={!item}><Download className="h-4 w-4 mr-2"/>Download</Button>{canEdit && <Button variant="outline" disabled={!changed || invalid || mutation.isPending} onClick={()=>mutation.mutate('save')}>Save adjustments</Button>}{canProcess && !paid && <Button className="flex-1 min-h-11 whitespace-normal" disabled={mutation.isPending || invalid || ptLoading || ptError || bankLoading || bankError || bankInvalid || (!processed && stale)} onClick={()=>mutation.mutate(processed?'pay':'process')}>{mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}{processed?'Record payment':'Process salary'}</Button>}</div></div>
  </SheetContent></Sheet>;
}