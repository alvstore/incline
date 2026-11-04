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
import { Loader2, Download, RefreshCw, FileText } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { downloadSalarySlip } from '@/lib/hrm/salarySlip';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { can, canManageHrRow } from '@/lib/auth/permissions';
import { attendanceValues, payrollNet, payrollPaymentBlocker, type PayrollItem } from '@/lib/hrm/payroll';
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
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [paymentDate,setPaymentDate]=useState(today);
  const [preview,setPreview]=useState(false);
  const [slipBusy,setSlipBusy]=useState(false);
  const [bank,setBank]=useState<Bank>({bank_name:'',bank_account:'',bank_ifsc:''});
  const paid=item?.status==='paid';
  const processed=item?.status==='processed';
  const canEdit=canManageHrRow(roles,item?.user_id,user?.id) && !paid && !processed;
  const canProcess=can.manageStaff(roles) && roles.some(r=>r.role==='owner' || r.role==='admin');
  const canSaveBank=canProcess && !paid && !processed;
  const {data:pt=[],isLoading:ptLoading,isError:ptError,refetch:retryPt}=useQuery({
    queryKey:['pt_settlements',item?.id],enabled:open && !!item,
    queryFn:async()=>{if(!item)return [];const {data,error}=await supabase.rpc('payroll_item_pt_breakdown',{p_item_id:item.id});if(error)throw error;return (data || []).filter(r=>item.status==='paid' ? r.settled : item.status==='processed' ? item.prepared_installment_ids?.includes(r.installment_id) : true).map(r=>({...r,amount:Number(r.amount)})) as PtRow[];},
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
  useEffect(()=>{setPreview(false);setPaymentDate(item?.payment_date || (item?.status==='paid' ? '' : today));},[item?.id,item?.payment_date,item?.status,open,today]);
  const {data:expense,isError:expenseError}=useQuery({queryKey:['payroll-expense',item?.id],enabled:open && paid && !!item,queryFn:async()=>{if(!item)return null;const {data,error}=await supabase.from('expenses').select('id,amount,paid_at,payment_method,payment_reference').eq('payroll_item_id',item.id).maybeSingle();if(error)throw error;return data;}});
  useEffect(()=>{if(!item)return;setValues(Object.fromEntries(fields.map(f=>[f,Number(item[f] || 0)])) as Record<Field,number>);setReason('');setMethod(item.payment_method || 'bank_transfer');setReference(item.payment_reference || '');},[item,open]);
  useEffect(()=>{setSelected(processed ? item?.prepared_installment_ids || [] : pt.filter(r=>paid ? r.settled : !r.settled).map(r=>r.installment_id));},[pt,processed,paid,item?.prepared_installment_ids]);
  useEffect(()=>{setBank({bank_name:bankData?.bank_name || '',bank_account:bankData?.bank_account || '',bank_ifsc:bankData?.bank_ifsc || ''});},[bankData]);
  const changed=!!item && fields.some(f=>values[f]!==Number(item[f] || 0));
  const ptTotal=paid || processed ? Number(item?.final_pt_commission || 0) : pt.filter(r=>selected.includes(r.installment_id)).reduce((s,r)=>s+r.amount,0);
  const net=paid || processed ? Number(item?.final_net || 0) : payrollNet({base:values.final_base,pt:ptTotal,ot:values.final_ot,bonus:values.final_bonus,deductions:values.final_deductions,advance:values.final_advance,penalty:values.final_penalty});
  const paymentBlocker=payrollPaymentBlocker(method,reference,paymentDate,today);
  const invalid=fields.some(f=>!Number.isFinite(values[f]) || values[f]<0) || net<0 || (changed && !reason.trim());
  const bankInvalid=method==='bank_transfer' && (!/^\d{6,24}$/.test(bank.bank_account) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bank.bank_ifsc));
  const stale=!!item && (!!item.attendance_changed_at || item.snapshot_period_end!==periodEnd);
  const mutation=useMutation({
    mutationFn:async(action:'save'|'process'|'pay'|'recalculate'|'bank')=>{
      if(!item)throw new Error('Select a salary');
      if(action==='bank'){const {error}=await supabase.rpc('payroll_save_bank',{p_item_id:item.id,p_bank:bank});if(error)throw error;}
      if(action==='recalculate'){const {error}=await supabase.rpc('payroll_recalculate_item',{p_item_id:item.id,p_reason:'Attendance and overtime policy reviewed'});if(error)throw error;}
      if(action==='save'){const {error}=await supabase.rpc('payroll_adjust_item',{p_item_id:item.id,p_patch:values,p_reason:reason});if(error)throw error;}
      if(action==='process'){const {error}=await supabase.rpc('payroll_prepare_item',{p_item_id:item.id,p_installment_ids:selected,p_patch:values,p_reason:reason || 'Salary reviewed for processing',p_method:method,p_bank:bank});if(error)throw error;}
      if(action==='pay'){const {error}=await supabase.rpc('payroll_record_payment',{p_item_id:item.id,p_method:method,p_reference:reference.trim(),p_payment_date:paymentDate});if(error)throw error;}
      return action;
    },
    onSuccess:action=>{toast.success(action==='bank'?'Bank details saved':action==='pay'?'Payment and salary expense recorded':action==='process'?'Salary saved — ready for remittance':action==='save'?'Salary adjustments saved':'Salary recalculated; manual adjustments preserved');['finance-expenses','expenses-console','finance-monthly-report','pending-expenses','expenses','expense-stats','payroll-expense','payroll-run-priority','payroll-items','payroll-runs','payroll-audit','payroll-calculation','payroll-bank','payroll-banks','pt_settlements','salary-advances','pending-advance'].forEach(k=>qc.invalidateQueries({queryKey:[k]}));},
    onError:(e:Error)=>toast.error(e.message),
  });
  const a=item?attendanceValues(item):{};
  const editing=canEdit && !preview;
  const readyForSave=!invalid && !ptLoading && !ptError && !stale && (method!=='bank_transfer' || (!bankLoading && !bankError && !bankInvalid));
  const download=()=>{if(!item)return;exportToCSV([{Staff:item.profile?.full_name,Period:`${periodStart} to ${item.snapshot_period_end || periodEnd}`,Status:item.status,'Payable days':a.payable_days,'Month days':a.total_days,'Half days':a.half_day,'Monthly salary':a.monthly_salary,'Salary earned':values.final_base,'PT commission':ptTotal,Overtime:values.final_ot,Bonus:values.final_bonus,Deductions:values.final_deductions,Advance:values.final_advance,Penalty:values.final_penalty,'Net payout':net,Method:method,Reference:reference,'Payment date':paymentDate,Reason:item.adjustment_reason,Bank:bank.bank_name,'Bank account':bank.bank_account,IFSC:bank.bank_ifsc,'PT entries':pt.filter(r=>selected.includes(r.installment_id)).map(r=>`${r.member_name}: ${money(r.amount)} (${r.payout_month})`).join('; '),'OT hours':a.ot_hours,'OT rate':a.ot_hourly_rate,'OT multiplier':a.ot_multiplier}],`salary-${item.profile?.full_name || item.id}`);};
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full sm:max-w-xl p-0 flex flex-col h-[100dvh]">
    <SheetHeader className="px-6 py-5 border-b border-border shrink-0"><div className="flex items-center gap-4"><Avatar className="h-14 w-14"><AvatarImage src={item?.profile?.avatar_url || undefined} alt="" className="object-cover"/><AvatarFallback className="font-semibold">{(item?.profile?.full_name || '?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0 text-left"><SheetTitle className="truncate">Salary — {item?.profile?.full_name || 'Staff'}</SheetTitle><SheetDescription className="capitalize">{item?.staff_kind} · {new Date(`${periodStart}T00:00:00`).toLocaleDateString('en-IN',{month:'long',year:'numeric'})} · <Badge variant="outline">{item?.status}</Badge></SheetDescription></div></div></SheetHeader>
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      <ol aria-label="Salary progress" className="grid grid-cols-4 gap-2 text-xs">{['Calculate','Preview','Saved','Paid'].map((step,index)=><li key={step} aria-current={index===(paid?3:processed?2:preview?1:0)?'step':undefined} className={index===(paid?3:processed?2:preview?1:0)?'font-semibold text-primary border-b-2 border-primary pb-2':'text-muted-foreground border-b border-border pb-2'}>{index+1}. {step}</li>)}</ol>
      {preview && !processed && !paid && <h2 className="font-semibold">Salary preview</h2>}
      {processed && <Badge className="bg-warning/15 text-warning">Saved · awaiting remittance</Badge>}
      <section className="space-y-2"><h3 className="font-semibold">Attendance & salary</h3><div className="grid grid-cols-2 gap-3 text-sm"><div>Payable days <strong>{a.payable_days ?? 0} / {a.total_days ?? 0}</strong></div><div>Half days <strong>{a.half_day ?? 0}</strong></div><div>Shifts <strong>{a.shifts_attended ?? 0} / {a.shifts_rostered ?? 0}</strong></div><div>Monthly salary <strong>{money(a.monthly_salary || 0)}</strong></div></div><p className="text-sm text-muted-foreground">{money(a.monthly_salary || 0)} / {a.total_days || 0} days × {a.payable_days || 0} payable days = {money(Number(item?.calc_base || 0))}</p>
      {paid && <div className="bg-muted p-3 rounded-xl text-sm">Paid snapshot preserved through {item?.snapshot_period_end}. {currentLoading?'Checking corrected attendance…':currentError?'Corrected attendance unavailable.':`Current full-month attendance: ${current?.attendance.payable_days ?? 0} / ${current?.attendance.total_days ?? 0} payable days; calculated base ${money(Number(current?.base || 0))}.`} Saved payment: {money(Number(item?.final_net || 0))}.</div>}
      {stale && !paid && <p role="alert" className="text-warning text-sm">Attendance or payroll period changed. Recalculate before processing.</p>}
      {editing && <Button variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={()=>mutation.mutate('recalculate')}><RefreshCw className="h-4 w-4 mr-2"/>Recalculate attendance</Button>}
      </section>
      <section className="space-y-3"><h3 className="font-semibold">Earnings & deductions</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{fields.map(f=><div key={f}><Label htmlFor={f}>{labels[f]}</Label><Input id={f} type="number" inputMode="decimal" min="0" step="0.01" value={values[f]} disabled={!editing} onChange={e=>setValues(v=>({...v,[f]:Number(e.target.value)}))}/></div>)}</div><p className="text-xs text-muted-foreground">Saved overtime: {a.ot_hours || 0}h × {money(a.ot_hourly_rate || 0)} × {a.ot_multiplier || 0}. Advance recovery is saved for this pay cycle, not today’s outstanding balance.</p>{editing && <div><Label htmlFor="salary-reason">Adjustment reason{changed?' *':''}</Label><Input id="salary-reason" value={reason} onChange={e=>setReason(e.target.value)} aria-required={changed}/></div>}{item?.adjustment_reason && <p className="text-sm text-muted-foreground">Saved reason: {item.adjustment_reason}</p>}</section>
      <section className="space-y-3"><h3 className="font-semibold">PT commission · {money(ptTotal)}</h3>{ptLoading?<Skeleton className="h-24"/>:ptError?<Button variant="outline" onClick={()=>retryPt()}>Retry PT entries</Button>:pt.length===0?<p className="text-sm text-muted-foreground">No eligible PT entries for this salary.</p>:<div className="max-h-64 overflow-y-auto divide-y divide-border">{pt.map(r=><label key={r.installment_id} className="flex min-h-11 items-center gap-3 py-3"><Checkbox checked={selected.includes(r.installment_id)} disabled={!editing || r.settled} aria-label={`Include ${r.member_name}`} onCheckedChange={v=>setSelected(s=>v?[...s,r.installment_id]:s.filter(id=>id!==r.installment_id))}/><span className="flex-1 text-sm">{r.member_name}<span className="block text-muted-foreground text-xs">{r.payout_month}</span></span><span className="text-sm tabular-nums">{money(r.amount)}{r.settled?' · paid':''}</span></label>)}</div>}</section>
      <section className="space-y-4"><h3 className="font-semibold">Remittance</h3><Label htmlFor="salary-method">Payment method</Label><Select value={method} onValueChange={setMethod} disabled={paid || processed || preview}><SelectTrigger id="salary-method"><SelectValue/></SelectTrigger><SelectContent>{['bank_transfer','cash','upi','cheque'].map(m=><SelectItem key={m} value={m}>{m.replace('_',' ')}</SelectItem>)}</SelectContent></Select>
      {method==='bank_transfer' && <>{bankLoading?<Skeleton className="h-24"/>:bankError?<p role="alert">Bank details could not be loaded.</p>:<div className="space-y-3">{(['bank_name','bank_account','bank_ifsc'] as const).map(k=><div key={k}><Label htmlFor={k}>{k.replace('bank_','Bank ')}</Label><Input id={k} value={bank[k]} disabled={!canSaveBank || preview} onChange={e=>setBank(b=>({...b,[k]:k==='bank_ifsc'?e.target.value.toUpperCase():e.target.value}))}/></div>)}</div>}{canSaveBank && !preview && <Button variant="outline" disabled={bankInvalid || mutation.isPending} onClick={()=>mutation.mutate('bank')}>Save bank details</Button>}{bankInvalid && !paid && <p className="text-sm text-destructive">Enter a valid account number and IFSC before bank remittance.</p>}</>}
      {(processed || paid) && <><div><Label htmlFor="salary-payment-date">Payment date</Label><Input id="salary-payment-date" type="date" max={today} disabled={paid} value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></div><div><Label htmlFor="salary-reference">{method==='cash'?'Cash voucher / acknowledgment (optional)':'UTR / payment reference *'}</Label><Input id="salary-reference" disabled={paid} aria-required={method!=='cash'} value={reference} onChange={e=>setReference(e.target.value)}/></div>{processed && paymentBlocker && <p role="alert" className="text-sm text-destructive">{paymentBlocker}</p>}</>}</section>
      {paid && <section className="space-y-2"><h3 className="font-semibold">Expense record</h3><p className="text-sm text-muted-foreground">{expenseError?'Expense record could not be loaded.':expense?`Paid salary expense · ${money(Number(expense.amount))} · ${expense.paid_at}`:'Historical payment: no linked expense record. No new expense has been created.'}</p></section>}
      <section className="space-y-2"><h3 className="font-semibold">Salary history</h3>{historyError?<p className="text-sm text-destructive">Salary history unavailable.</p>:history.map(h=><div key={h.id} className="text-xs border-b border-border py-2"><span className="font-medium">{h.action.replace(/_/g,' ')}</span> · {new Date(h.created_at).toLocaleString('en-IN')} {h.reason && <p className="text-muted-foreground">{h.reason}</p>}</div>)}</section>
    </div>
    <div className="border-t border-border px-6 py-4 pb-safe space-y-3 bg-card shrink-0">
      <div className="flex justify-between items-center" aria-live="polite"><span>Net payout</span><strong className="text-2xl tabular-nums">{money(net)}</strong></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="min-h-11" disabled={!item || slipBusy} onClick={async()=>{if(!item)return;setSlipBusy(true);try{await downloadSalarySlip(item,periodStart,periodEnd,branchId);toast.success('Salary slip downloaded');}catch(e){toast.error(e instanceof Error?e.message:'Could not create salary slip');}finally{setSlipBusy(false);}}}>{slipBusy?<Loader2 className="h-4 w-4 mr-2 animate-spin"/>:<FileText className="h-4 w-4 mr-2"/>}Salary slip (PDF)</Button>
        <Button variant="ghost" className="min-h-11" onClick={download} disabled={!item || ptLoading || ptError}><Download className="h-4 w-4 mr-2"/>CSV</Button>
        {editing && <Button className="flex-1 min-h-11" disabled={!readyForSave || mutation.isPending} onClick={()=>setPreview(true)}>Preview salary</Button>}
        {preview && canEdit && <><Button variant="outline" disabled={mutation.isPending} onClick={()=>setPreview(false)}>Back to edit</Button>{canProcess && <Button className="flex-1 min-h-11" disabled={!readyForSave || mutation.isPending} onClick={()=>mutation.mutate('process')}>{mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}Save salary</Button>}</>}
        {processed && canProcess && <Button className="flex-1 min-h-11" disabled={mutation.isPending || !!paymentBlocker} onClick={()=>mutation.mutate('pay')}>{mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}Record payment & expense</Button>}
      </div>
    </div>
  </SheetContent></Sheet>;
}
