import { useRef } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Loader2 } from 'lucide-react';
import { getMembershipFreezeContext, resumeMembershipFreeze } from '@/services/membershipActionsService';
import { formatISTDate } from '@/lib/utils/datetime';
import { invalidateMembersData } from '@/lib/memberInvalidation';
import { useRowsEntrance } from '@/components/motion/pageMotion';
interface Props { open: boolean; onOpenChange: (open: boolean) => void; membership: { id: string } | null; memberName: string }
export function UnfreezeMembershipDrawer({ open, onOpenChange, membership, memberName }: Props) {
  const client = useQueryClient(); const scope = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: ['freeze-context', membership?.id], enabled: open && !!membership, queryFn: () => getMembershipFreezeContext(membership?.id ?? ''), staleTime: 0 });
  const data = query.data; const freeze = data?.current_freeze;
  useRowsEntrance(scope, `${open}:${query.isLoading}`);
  const submit = useMutation({ mutationFn: () => resumeMembershipFreeze(membership?.id ?? ''), onSuccess: result => {
    toast.success(`Membership resumed · expiry ${formatISTDate(result.new_end_date)}`); invalidateMembersData(client);
    ['freeze-context', 'memberships', 'my-requests', 'freeze-details'].forEach(key => client.invalidateQueries({ queryKey: [key] })); onOpenChange(false);
  }, onError: (e: Error) => toast.error(e.message) });
  if (!membership) return null;
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg motion-reduce:animate-none">
    <SheetHeader className="px-6 py-5 pr-12 text-left"><SheetTitle className="flex items-center gap-2"><Play className="h-5 w-5" aria-hidden="true" />Resume membership</SheetTitle><SheetDescription>{memberName}</SheetDescription></SheetHeader>
    <div ref={scope} className="flex-1 space-y-5 overflow-y-auto px-6 pb-6" aria-busy={query.isLoading}>
      {query.isLoading ? <div role="status" aria-label="Loading active freeze"><Skeleton className="h-32 rounded-xl" /></div> : query.isError ? <div role="alert"><p>Unable to load the active freeze.</p><Button variant="outline" onClick={() => query.refetch()}>Try again</Button></div> : data && <>
        <div data-anim="row" className="space-y-2 rounded-xl bg-muted/50 p-4"><p className="font-semibold">{data.plan_name}</p><p className="text-sm">{freeze?.mode === 'override' ? 'Approved management exception' : 'Approved freeze'}</p><p className="text-sm text-muted-foreground">{freeze?.reason}</p></div>
        <dl data-anim="row" className="space-y-4 text-sm"><div className="flex justify-between gap-4"><dt>Freeze started</dt><dd>{formatISTDate(freeze?.start_date)}</dd></div><div className="flex justify-between gap-4"><dt>Last frozen day</dt><dd>{formatISTDate(freeze?.end_date)}</dd></div><div className="flex justify-between gap-4"><dt>Actual paused days</dt><dd className="font-semibold">{data.actual_days}</dd></div><div className="flex justify-between gap-4"><dt>Expiry before this freeze</dt><dd>{formatISTDate(freeze?.baseline_end_date)}</dd></div><div className="flex justify-between gap-4 rounded-xl bg-secondary p-4"><dt>Expiry if resumed today</dt><dd className="font-semibold">{formatISTDate(data.resume_end_date)}</dd></div></dl>
        <p data-anim="row" className="text-sm text-muted-foreground">Only actual paused days are added. The remaining requested days are not credited; gate access is re-evaluated on resume.</p>
        {(!freeze?.applied_at || !freeze.baseline_end_date || data.membership.status !== 'frozen') && <p role="alert" className="text-sm text-destructive">No active freeze with a verified expiry snapshot.</p>}
      </>}
    </div>
    <SheetFooter className="gap-2 px-6 py-4 pb-safe"><Button variant="outline" className="min-h-11" onClick={() => onOpenChange(false)} disabled={submit.isPending}>Cancel</Button><Button className="min-h-11" onClick={() => submit.mutate()} disabled={query.isFetching || query.isError || !freeze?.applied_at || !freeze.baseline_end_date || data?.membership.status !== 'frozen' || submit.isPending}>{submit.isPending && <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />}{submit.isPending ? 'Resuming…' : 'Confirm resume'}</Button></SheetFooter>
  </SheetContent></Sheet>;
}
