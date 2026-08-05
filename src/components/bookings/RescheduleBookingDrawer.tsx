import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, addDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CalendarClock, Loader2, ShieldCheck, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RescheduleTarget {
  id: string;
  member_name?: string | null;
  member_code?: string | null;
  benefit_name?: string | null;
  slot_time?: string | null;
  slot_date?: string | null;
  slot_id: string;
}

interface Props {
  booking: RescheduleTarget | null;
  branchId: string;
  onOpenChange: (open: boolean) => void;
}

const REASONS = [
  { value: 'equipment_failure', label: 'Equipment failure', blame: 'gym' },
  { value: 'power_outage', label: 'Power outage', blame: 'gym' },
  { value: 'staff_unavailable', label: 'Staff unavailable', blame: 'gym' },
  { value: 'facility_maintenance', label: 'Facility maintenance', blame: 'gym' },
  { value: 'member_request', label: 'Member request', blame: 'member' },
];

export function RescheduleBookingDrawer({ booking, branchId, onOpenChange }: Props) {
  const { roles } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canApprove = useMemo(
    () => (roles || []).some((r) => ['owner', 'admin', 'manager'].includes(r.role)),
    [roles],
  );

  const [reason, setReason] = useState('equipment_failure');
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'move' | 'restore'>('move');
  const [targetDate, setTargetDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [newSlotId, setNewSlotId] = useState<string | null>(null);

  useEffect(() => {
    if (booking) {
      setReason('equipment_failure');
      setNotes('');
      setMode('move');
      setNewSlotId(null);
      setTargetDate(booking.slot_date || format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    }
  }, [booking]);

  const blame = REASONS.find((r) => r.value === reason)?.blame ?? 'gym';

  // Candidate slots: same facility as the current booking, on the chosen date.
  const { data: slots = [], isLoading: loadingSlots } = useQuery({
    queryKey: ['reschedule-slots', booking?.slot_id, targetDate, branchId],
    enabled: !!booking && mode === 'move' && !!targetDate,
    queryFn: async () => {
      const { data: current } = await supabase
        .from('benefit_slots')
        .select('facility_id, benefit_type_id')
        .eq('id', booking!.slot_id)
        .maybeSingle();

      await supabase.rpc('ensure_facility_slots', {
        p_branch_id: branchId,
        p_start_date: targetDate,
        p_end_date: targetDate,
      });

      let q = supabase
        .from('benefit_slots')
        .select('id, start_time, end_time, capacity, booked_count, is_active')
        .eq('branch_id', branchId)
        .eq('slot_date', targetDate)
        .eq('is_active', true)
        .order('start_time');

      if (current?.facility_id) q = q.eq('facility_id', current.facility_id);
      else if (current?.benefit_type_id) q = q.eq('benefit_type_id', current.benefit_type_id);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []).filter((s) => s.id !== booking!.slot_id);
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const { data: req, error } = await supabase.rpc('request_booking_reschedule', {
        p_booking_id: booking!.id,
        p_new_slot_id: mode === 'move' ? newSlotId : null,
        p_reason: `${REASONS.find((r) => r.value === reason)?.label}${notes ? ` — ${notes}` : ''}`,
        p_blame: blame,
        p_restore_credit: mode === 'restore',
      });
      if (error) throw error;

      const requestId = (req as { request_id?: string } | null)?.request_id;
      if (canApprove && requestId) {
        const { error: decideErr } = await supabase.rpc('decide_booking_reschedule', {
          p_request_id: requestId,
          p_approve: true,
          p_notes: 'Auto-approved by manager/admin',
        });
        if (decideErr) throw decideErr;
        return 'approved' as const;
      }
      return 'pending' as const;
    },
    onSuccess: (result) => {
      toast({
        title: result === 'approved' ? 'Booking updated' : 'Sent for approval',
        description:
          result === 'approved'
            ? mode === 'restore'
              ? 'Session credit returned to the member.'
              : 'Booking moved to the new slot.'
            : 'The branch manager, admin or owner will review this request.',
      });
      ['all-benefit-bookings', 'benefit-slots', 'slot-availability-timeline', 'slot-detail', 'booking-audit', 'pending-reschedules', 'prep-queue'].forEach(
        (k) => queryClient.invalidateQueries({ queryKey: [k] }),
      );
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      toast({
        variant: 'destructive',
        title: 'Could not reschedule',
        description: (err as Error)?.message ?? 'Unknown error',
      });
    },
  });

  const disabled = submit.isPending || (mode === 'move' && !newSlotId);

  return (
    <Sheet open={!!booking} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            Reschedule booking
          </SheetTitle>
          <SheetDescription>
            {canApprove
              ? 'Applied immediately and written to the booking audit trail.'
              : 'Sent to the branch manager, admin or owner for approval.'}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-6">
            {booking && (
              <div className="rounded-2xl bg-muted/50 p-4 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Current booking
                </p>
                <p className="font-semibold">{booking.member_name || booking.member_code}</p>
                <p className="text-sm text-muted-foreground">
                  {booking.benefit_name} · {booking.slot_date} · {booking.slot_time}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="reschedule-reason">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id="reschedule-reason" className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Fault attribution:{' '}
                <Badge variant="outline" className={blame === 'gym'
                  ? 'bg-warning/10 text-warning border-warning/25'
                  : 'bg-muted text-foreground border-border'}>
                  {blame === 'gym' ? 'Gym fault' : 'Member fault'}
                </Badge>
              </p>
            </div>

            <div className="space-y-2">
              <Label>Outcome</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('move')}
                  className={cn(
                    'rounded-xl border p-3 text-left text-sm transition-all cursor-pointer focus:ring-2 focus:ring-primary focus:outline-none',
                    mode === 'move' ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:bg-muted/50',
                  )}
                >
                  <span className="font-medium flex items-center gap-1.5">
                    <CalendarClock className="h-4 w-4" /> Move slot
                  </span>
                  <span className="text-xs text-muted-foreground">Same session, new time</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('restore')}
                  className={cn(
                    'rounded-xl border p-3 text-left text-sm transition-all cursor-pointer focus:ring-2 focus:ring-primary focus:outline-none',
                    mode === 'restore' ? 'border-primary bg-primary/5 shadow-sm' : 'border-border hover:bg-muted/50',
                  )}
                >
                  <span className="font-medium flex items-center gap-1.5">
                    <Undo2 className="h-4 w-4" /> Return credit
                  </span>
                  <span className="text-xs text-muted-foreground">Cancel, give session back</span>
                </button>
              </div>
            </div>

            {mode === 'move' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="reschedule-date">New date</Label>
                  <Input
                    id="reschedule-date"
                    type="date"
                    value={targetDate}
                    onChange={(e) => { setTargetDate(e.target.value); setNewSlotId(null); }}
                    className="rounded-xl"
                  />
                </div>

                <div className="space-y-2">
                  <Label>New time slot</Label>
                  {loadingSlots ? (
                    <div className="grid grid-cols-3 gap-2">
                      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
                    </div>
                  ) : slots.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center rounded-xl bg-muted/40">
                      No slots available on this date.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map((s) => {
                        const full = (s.booked_count ?? 0) >= (s.capacity ?? 0);
                        const selected = newSlotId === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={full}
                            onClick={() => setNewSlotId(s.id)}
                            className={cn(
                              'rounded-lg border px-2 py-2 text-xs font-medium transition-all cursor-pointer focus:ring-2 focus:ring-primary focus:outline-none',
                              full && 'opacity-40 cursor-not-allowed',
                              selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border hover:bg-muted/60',
                            )}
                          >
                            {String(s.start_time).slice(0, 5)}
                            <span className="block text-[10px] opacity-70">
                              {s.booked_count}/{s.capacity}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="reschedule-notes">Notes for the audit trail</Label>
              <Textarea
                id="reschedule-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional context — what happened, who was informed…"
                className="rounded-xl min-h-[80px]"
              />
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="px-6 py-4 border-t gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={disabled} className="rounded-xl gap-2">
            {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {canApprove ? <ShieldCheck className="h-4 w-4" /> : null}
            {canApprove ? 'Reschedule now' : 'Send for approval'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
