import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Snowflake, ShieldCheck, Loader2, Calendar, AlertCircle } from 'lucide-react';
import { freezeMembership, getMembershipFreezeContext } from '@/services/membershipActionsService';
import { freezeNeedsApproval, freezeValidation, shiftFreezeDate, type FreezeMode } from '@/lib/membership/freezePolicy';
import { getISTToday, formatISTDate } from '@/lib/utils/datetime';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { useRowsEntrance } from '@/components/motion/pageMotion';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; membership: { id: string } | null; memberName: string; onSuccess?: () => void }
export function FreezeMembershipDrawer({ open, onOpenChange, membership, memberName, onSuccess }: Props) {
  const client = useQueryClient();
  const scope = useRef<HTMLDivElement>(null);
  const [days, setDays] = useState(7);
  const [start, setStart] = useState(getISTToday());
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<FreezeMode>('plan');
  const context = useQuery({ queryKey: ['freeze-context', membership?.id], enabled: open && !!membership?.id, queryFn: () => getMembershipFreezeContext(membership?.id ?? ''), staleTime: 0 });
  const data = context.data;
  useEffect(() => { if (open) { setDays(7); setStart(getISTToday()); setReason(''); setMode('plan'); } }, [open, membership?.id]);
  useRowsEntrance(scope, `${open}:${context.isLoading}`);
  const error = data ? freezeValidation({ mode, days, reason, remaining: data.remaining, minDays: data.min_days, maxDays: data.max_days, exceptionsEnabled: data.exceptions_enabled, fee: data.fee }) : null;
  const dateError = data && (start < data.today || start > data.membership.end_date || !start) ? 'Choose a start date during the active membership.' : null;
  const approval = data ? freezeNeedsApproval(mode, data.can_override) : true;
  const refresh = () => { invalidateMembersData(client); ['freeze-context', 'approval-queue', 'approval-stats', 'memberships', 'my-requests', 'freeze-details'].forEach(key => client.invalidateQueries({ queryKey: [key] })); };
  const submit = useMutation({ mutationFn: async () => {
    if (!data || error || dateError || data.current_freeze) throw new Error(error || dateError || 'A freeze is already pending or approved.');
    return freezeMembership({ membershipId: data.membership.id, freezeDays: days, reason, mode, startDate: start });
  }, onSuccess: result => { toast.success(result.status === 'pending' ? 'Freeze sent for management approval' : result.status === 'scheduled' ? 'Freeze scheduled' : 'Membership frozen'); refresh(); onSuccess?.(); onOpenChange(false); }, onError: (e: Error) => toast.error(e.message) });
  const flag = useMutation({ mutationFn: async (enabled: boolean) => {
    if (!data) return;
    const { error: err } = await supabase.rpc('set_membership_freeze_exceptions', { p_branch_id: data.membership.branch_id, p_enabled: enabled });
    if (err) throw err;
  }, onSuccess: () => { context.refetch(); toast.success('Branch freeze exception policy updated'); }, onError: (e: Error) => toast.error(e.message) });
  if (!membership) return null;
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg motion-reduce:animate-none">
      <SheetHeader className="shrink-0 px-6 py-5 pr-12 text-left">
        <SheetTitle className="flex items-center gap-2"><Snowflake className="h-5 w-5 text-primary" aria-hidden="true" />Freeze membership</SheetTitle>
        <SheetDescription>{memberName}</SheetDescription>
      </SheetHeader>
      <div ref={scope} className="flex-1 space-y-5 overflow-y-auto px-6 pb-6" aria-busy={context.isLoading}>
        {context.isLoading ? <div role="status" aria-label="Loading freeze allowance" className="space-y-4"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-44 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div> : context.isError ? <div role="alert" className="space-y-3"><p>Freeze details could not be loaded.</p><Button variant="outline" onClick={() => context.refetch()}>Try again</Button></div> : data && <>
          <div data-anim="row" className="space-y-3 rounded-xl bg-muted/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{data.plan_name}</p><p className="text-sm text-muted-foreground">Expiry · {formatISTDate(data.membership.end_date)}</p></div><Badge variant="secondary">{data.remaining} days available</Badge></div>
            <Progress value={data.allowance > 0 ? Math.min(100, data.used / data.allowance * 100) : 0} aria-label="Plan freeze days used" />
            <div className="flex justify-between text-sm"><span>{data.used} used</span><span>{data.allowance} included</span></div>
          </div>
          {data.can_override && <div data-anim="row" className="flex items-center justify-between gap-4 rounded-xl bg-secondary p-4"><div><Label htmlFor="freeze-exceptions">Allow branch freeze exceptions</Label><p className="text-xs text-muted-foreground">Paid freezes and management waivers</p></div><Switch id="freeze-exceptions" checked={data.exceptions_enabled} disabled={flag.isPending} onCheckedChange={v => flag.mutate(v)} /></div>}
          {data.current_freeze ? <div role="status" className="rounded-xl bg-muted p-4"><p className="font-semibold">Freeze already {data.current_freeze.status}</p><p className="text-sm">{formatISTDate(data.current_freeze.start_date)} – {formatISTDate(data.current_freeze.end_date)}</p><p className="mt-2 text-sm text-muted-foreground">{data.current_freeze.reason}</p></div> : <>
            <fieldset data-anim="row" className="space-y-2"><legend className="mb-2 text-sm font-medium">Freeze type</legend><div className="grid grid-cols-3 gap-2">{([['plan', 'Plan days'], ['paid', 'Paid'], ['override', 'Exception']] as const).map(([value, label]) => <Button key={value} variant={mode === value ? 'default' : 'outline'} className="min-h-11 px-2" aria-pressed={mode === value} disabled={value !== 'plan' && (!data.exceptions_enabled || (value === 'paid' && data.fee <= 0))} onClick={() => setMode(value)}>{label}</Button>)}</div></fieldset>
            <div data-anim="row" className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="freeze-start">Start date</Label><Input id="freeze-start" type="date" value={start} min={data.today} max={data.membership.end_date} onChange={e => setStart(e.target.value)} aria-invalid={!!dateError} aria-describedby="freeze-error" className="min-h-11 text-base" /></div><div className="space-y-2"><Label htmlFor="freeze-days">Duration (days)</Label><Input id="freeze-days" type="number" min={mode === 'override' ? 1 : data.min_days} max={mode === 'override' ? 365 : data.max_days} value={Number.isNaN(days) ? '' : days} onChange={e => setDays(e.target.valueAsNumber)} aria-describedby="freeze-error" className="min-h-11 text-base" /></div></div>
            <div className="flex flex-wrap gap-2">{[7, 14, 30].map(n => <Button key={n} size="sm" variant="outline" className="min-h-11" aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</Button>)}</div>
            <div data-anim="row" className="space-y-2"><Label htmlFor="freeze-reason">Reason (required)</Label><Textarea id="freeze-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000} aria-required="true" aria-describedby="freeze-error" placeholder="Medical leave, travel or management concession…" className="text-base" /></div>
            <dl data-anim="row" className="space-y-3 rounded-xl bg-muted/50 p-4 text-sm"><div className="flex justify-between gap-3"><dt className="flex items-center gap-2"><Calendar className="h-4 w-4" aria-hidden="true" />Resume on</dt><dd>{start && Number.isInteger(days) ? formatISTDate(shiftFreezeDate(start, days)) : '—'}</dd></div><div className="flex justify-between gap-3"><dt>Projected expiry</dt><dd>{Number.isInteger(days) ? formatISTDate(shiftFreezeDate(data.membership.end_date, days)) : '—'}</dd></div><div className="flex justify-between"><dt>Freeze fee</dt><dd>₹{(mode === 'paid' ? data.fee : 0).toLocaleString('en-IN')}</dd></div><div className="flex items-start gap-2 text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{approval ? 'Pending management approval · access unchanged' : 'Gate access pauses when the freeze starts'}</span></div></dl>
            <p className="text-xs text-muted-foreground">Early resume credits only actual paused days. Paid fee is billed once the freeze starts.</p>
            <p id="freeze-error" role="status" aria-live="polite" className="min-h-5 text-sm text-destructive">{dateError || error}</p>
          </>}
        </>}
      </div>
      <SheetFooter className="shrink-0 gap-2 bg-background px-6 py-4 pb-safe"><Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={submit.isPending}>Cancel</Button><Button className="min-h-11" disabled={!data || context.isError || context.isFetching || !!error || !!dateError || !!data.current_freeze || data.membership.status !== 'active' || submit.isPending || flag.isPending} onClick={() => submit.mutate()}>{submit.isPending && <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}{submit.isPending ? 'Saving…' : approval ? 'Request approval' : start > (data?.today ?? '') ? 'Schedule freeze' : 'Confirm freeze'}</Button></SheetFooter>
    </SheetContent>
  </Sheet>;
}
