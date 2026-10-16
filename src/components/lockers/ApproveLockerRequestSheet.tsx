import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useLockerPricing } from '@/hooks/useLockerPricing';
import { lockerPricing, LOCKER_SIZES, type LockerSize } from '@/components/member/requests/requestTypes';
import { closeMemberRequestTask } from '@/lib/tasks/memberRequestTasks';
import { track } from '@/lib/analytics';

export interface LockerRequestRow {
  id: string;
  branch_id: string | null;
  reference_id: string | null;
  request_data: Record<string, unknown> | null;
}

interface Props {
  request: LockerRequestRow | null;
  onOpenChange: (o: boolean) => void;
}

export function ApproveLockerRequestSheet({ request, onOpenChange }: Props) {
  const qc = useQueryClient();
  const branchId = request?.branch_id ?? null;
  const preferred = (request?.request_data?.preferred_size as string) === 'Large' ? 'Large' : 'Medium';
  const [size, setSize] = useState<LockerSize>(preferred);
  const [lockerId, setLockerId] = useState('');
  const [notes, setNotes] = useState('');
  const { data: cfg } = useLockerPricing(branchId);

  useEffect(() => {
    if (request) { setSize(preferred); setLockerId(''); setNotes(''); }
  }, [request, preferred]);

  const { data: lockers = [], isLoading } = useQuery({
    queryKey: ['lockers', 'available', branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase.from('lockers').select('id, locker_number, size, location')
        .eq('branch_id', branchId!).eq('status', 'available').order('locker_number');
      if (error) throw error;
      return data ?? [];
    },
  });

  const quote = lockerPricing(size, cfg);

  const approve = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('approve_locker_request', {
        p_request_id: request!.id, p_locker_id: lockerId, p_size: size, p_notes: notes || null,
      });
      if (error) throw error;
      return data as { invoice_id?: string; locker_number?: string };
    },
    onSuccess: async (d) => {
      track('locker_request_approved', { size, gst_enabled: quote.gstRate > 0 });
      await closeMemberRequestTask({ memberId: request!.reference_id ?? '', referenceType: 'locker', decision: 'approved' });
      toast.success(`Locker ${d?.locker_number ?? ''} assigned — bill of ₹${quote.total.toLocaleString('en-IN')} created`, {
        description: 'The member can pay from My Invoices, or collect at the desk.',
      });
      qc.invalidateQueries({ queryKey: ['approval-queue'] });
      qc.invalidateQueries({ queryKey: ['approval-stats'] });
      qc.invalidateQueries({ queryKey: ['lockers'] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not approve'),
  });

  return (
    <Sheet open={!!request} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border p-6">
          <SheetTitle>Approve locker request</SheetTitle>
          <SheetDescription>Assigns the locker until membership end and creates the bill at your set price.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="space-y-2">
            <Label>Size</Label>
            <div className="grid grid-cols-2 gap-3" role="group" aria-label="Locker size">
              {LOCKER_SIZES.map((s) => (
                <Button key={s} type="button" variant={size === s ? 'default' : 'outline'} aria-pressed={size === s}
                  className="min-h-[44px]" onClick={() => setSize(s)}>{s}</Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="alr-locker">Locker</Label>
            <Select value={lockerId} onValueChange={setLockerId}>
              <SelectTrigger id="alr-locker"><SelectValue placeholder={isLoading ? 'Loading…' : lockers.length ? 'Pick a free locker' : 'No free lockers'} /></SelectTrigger>
              <SelectContent>
                {lockers.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.locker_number}{l.size ? ` · ${l.size}` : ''}{l.location ? ` · ${l.location}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-xl bg-muted/50 p-4 text-sm tabular-nums" aria-live="polite">
            <div className="flex justify-between"><span>Fee</span><span>₹{quote.base.toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between"><span>GST ({quote.gstRate}%)</span><span>₹{quote.gst.toLocaleString('en-IN')}</span></div>
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Bill total</span><span>₹{quote.total.toLocaleString('en-IN')}</span></div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="alr-notes">Note to member (optional)</Label>
            <Textarea id="alr-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 border-t border-border p-4">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" disabled={!lockerId || approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Approve & bill
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
