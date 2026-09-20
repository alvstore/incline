import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Ban, Bell, Loader2, Megaphone, RotateCcw, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { TrainerPicker } from '@/components/classes/TrainerPicker';
import { useTrainers } from '@/hooks/useTrainers';
import { useCancelClassSession, useOverrideClassSession, useReinstateClassSession } from '@/hooks/useClassTypes';
import { notifyClassSession } from '@/services/classTypeService';
import { formatTime12, istTimeKey, sessionInstructor, slotsLeft } from '@/lib/classes/schedule';
import { formatIST } from '@/lib/utils/datetime';
import type { ClassSession } from '@/types/classEngine';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: ClassSession | null;
  branchId: string;
  /** Open the roster / attendance for this session. */
  onOpenRoster?: (classId: string) => void;
}

/**
 * Master-calendar drawer for ONE generated session: swap the trainer for the
 * day, move the time, adjust capacity, or cancel just this slot. Booked
 * members are told about material changes over the branch's enabled channels.
 */
export function SessionOverrideDrawer({ open, onOpenChange, session, branchId, onOpenRoster }: Props) {
  const navigate = useNavigate();
  const { data: trainers } = useTrainers(branchId);
  const override = useOverrideClassSession();
  const cancel = useCancelClassSession();
  const reinstate = useReinstateClassSession();

  const [trainerId, setTrainerId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [capacity, setCapacity] = useState(20);
  const [venue, setVenue] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!open || !session) return;
    setTrainerId(session.trainer_id ?? '');
    setGuestName(session.external_trainer_name ?? '');
    setStartTime(istTimeKey(session.scheduled_at));
    setDuration(session.duration_minutes ?? 60);
    setCapacity(session.capacity ?? 20);
    setVenue(session.venue ?? '');
    setCancelReason('');
  }, [open, session]);

  const isCancelled = !!session?.cancelled_at;
  const isPast = session ? new Date(session.scheduled_at).getTime() < Date.now() : false;
  const busy = override.isPending || cancel.isPending || reinstate.isPending || resending;

  const dirty = useMemo(() => {
    if (!session) return false;
    return (
      trainerId !== (session.trainer_id ?? '')
      || guestName.trim() !== (session.external_trainer_name ?? '').trim()
      || startTime !== istTimeKey(session.scheduled_at)
      || duration !== (session.duration_minutes ?? 60)
      || capacity !== (session.capacity ?? 20)
      || venue.trim() !== (session.venue ?? '').trim()
    );
  }, [session, trainerId, guestName, startTime, duration, capacity, venue]);

  const handleSave = async () => {
    if (!session || !dirty) return;
    const originalTrainer = session.trainer_id ?? '';
    const originalGuest = (session.external_trainer_name ?? '').trim();
    const trainerCleared = !trainerId && !guestName.trim() && (originalTrainer || originalGuest);
    const venueChanged = venue.trim() !== (session.venue ?? '').trim();
    try {
      const { result, notify } = await override.mutateAsync({
        input: {
          classId: session.id,
          trainerId: trainerId || null,
          externalTrainerName: !trainerId && guestName.trim() ? guestName.trim() : null,
          clearTrainer: !!trainerCleared,
          capacity: capacity !== session.capacity ? capacity : null,
          startTime: startTime !== istTimeKey(session.scheduled_at) ? startTime : null,
          durationMinutes: duration !== session.duration_minutes ? duration : null,
          venue: venueChanged ? venue.trim() || null : null,
        },
        venueChanged,
      });
      const booked = result.member_ids?.length ?? 0;
      toast.success('Session updated', {
        description: notify
          ? `${notify.sent} notice${notify.sent === 1 ? '' : 's'} sent to ${booked} booked member${booked === 1 ? '' : 's'}.`
          : booked > 0 ? 'Booked members keep their spot.' : 'Only this session was changed — the rule is untouched.',
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not update session', { description: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };

  const handleCancel = async () => {
    if (!session) return;
    try {
      const { result, notify } = await cancel.mutateAsync({ classId: session.id, reason: cancelReason.trim() || undefined });
      setCancelOpen(false);
      const n = result.cancelled_bookings ?? 0;
      toast.success('Session cancelled', {
        description: n === 0
          ? 'Nobody had booked — the slot is simply gone from the timetable.'
          : `${n} booking${n === 1 ? '' : 's'} cancelled${result.credits_released ? `, ${result.credits_released} class credit${result.credits_released === 1 ? '' : 's'} returned` : ''}${notify ? `, ${notify.sent} notice${notify.sent === 1 ? '' : 's'} sent` : ''}.${result.paid_bookings ? ` ${result.paid_bookings} paid booking${result.paid_bookings === 1 ? '' : 's'} may need a refund.` : ''}`,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not cancel session', { description: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };

  const handleReinstate = async () => {
    if (!session) return;
    try {
      await reinstate.mutateAsync(session.id);
      toast.success('Session reinstated', { description: 'It is back on the timetable. Previous bookings are not restored.' });
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not reinstate session', { description: err instanceof Error ? err.message : 'Something went wrong' });
    }
  };

  const handleResendNotices = async () => {
    if (!session) return;
    setResending(true);
    const res = await notifyClassSession(session.id, 'session_cancelled', { reason: session.cancellation_reason });
    setResending(false);
    if (res.success) toast.success(`${res.sent} notice${res.sent === 1 ? '' : 's'} sent`, { description: 'Members already notified were skipped.' });
    else toast.error('Could not send notices', { description: res.error });
  };

  if (!session) return null;
  const instructor = sessionInstructor(session);
  const left = slotsLeft(session);

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          <SheetHeader className="border-b px-6 py-5 text-left">
            <div className="flex items-start gap-3">
              {session.banner_url || session.class_type?.image_url ? (
                <img src={session.banner_url ?? session.class_type?.image_url ?? ''} alt="" className="h-14 w-14 rounded-xl object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate">{session.name}</SheetTitle>
                <SheetDescription>
                  {formatIST(session.scheduled_at, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  {' · '}{session.duration_minutes} min · {instructor.name}{instructor.isGuest ? ' (guest)' : ''}
                </SheetDescription>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {isCancelled ? (
                    <Badge className="rounded-full bg-destructive/10 text-destructive hover:bg-destructive/10">Cancelled</Badge>
                  ) : left === 0 ? (
                    <Badge className="rounded-full bg-destructive/10 text-destructive hover:bg-destructive/10">Class full</Badge>
                  ) : (
                    <Badge className="rounded-full bg-success/10 text-success hover:bg-success/10">{left} spot{left === 1 ? '' : 's'} left</Badge>
                  )}
                  <Badge variant="secondary" className="rounded-full"><Users className="mr-1 h-3 w-3" />{session.booked_count} booked</Badge>
                  {session.is_overridden && !isCancelled && <Badge variant="outline" className="rounded-full">Hand-edited</Badge>}
                  {!session.template_id && <Badge variant="outline" className="rounded-full">One-off</Badge>}
                </div>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            {isCancelled ? (
              <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-foreground">This session was cancelled{session.cancellation_reason ? ` — ${session.cancellation_reason}` : ''}.</p>
                <p className="text-xs text-muted-foreground">
                  {session.cancellation_notified_at ? `Members were notified ${formatIST(session.cancellation_notified_at)}.` : 'Members have not been notified yet.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="cursor-pointer" onClick={handleResendNotices} disabled={busy}>
                    {resending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />} Send notices
                  </Button>
                  {!isPast && (
                    <Button size="sm" className="cursor-pointer" onClick={handleReinstate} disabled={busy}>
                      {reinstate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />} Reinstate
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {isPast && (
                  <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">This session has already run. Use the roster to mark attendance.</p>
                )}
                <TrainerPicker
                  trainers={trainers}
                  trainerId={trainerId}
                  guestName={guestName}
                  onChange={({ trainerId: t, guestName: g }) => { setTrainerId(t); setGuestName(g); }}
                />
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="ovr-start">Start time</Label>
                    <Input id="ovr-start" type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={isPast} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ovr-duration">Minutes</Label>
                    <Input id="ovr-duration" type="number" min={10} max={480} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} disabled={isPast} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ovr-capacity">Capacity</Label>
                    <Input id="ovr-capacity" type="number" min={Math.max(1, session.booked_count)} max={500} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
                    {capacity < session.booked_count && <p className="text-xs text-destructive">{session.booked_count} already booked.</p>}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ovr-venue">Studio / venue</Label>
                  <Input id="ovr-venue" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Studio 1" />
                </div>
                <p className="text-xs text-muted-foreground">
                  Changes here apply to <span className="font-medium text-foreground">this session only</span>. Booked members get a notice when the time, trainer or venue changes.
                  {session.template_id && ' The rule keeps generating the other days as usual.'}
                </p>
                {startTime !== istTimeKey(session.scheduled_at) && (
                  <p className="text-xs text-warning">New time: {formatTime12(startTime)} on the same day.</p>
                )}
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              {onOpenRoster && (
                <Button type="button" variant="outline" className="cursor-pointer" onClick={() => { onOpenChange(false); onOpenRoster(session.id); }}>
                  <Users className="mr-2 h-4 w-4" /> Roster
                </Button>
              )}
              {!isCancelled && !isPast && (
                <Button type="button" variant="outline" className="cursor-pointer" onClick={() => { onOpenChange(false); navigate(`/campaigns?announce_class=${session.id}`); }}>
                  <Megaphone className="mr-2 h-4 w-4" /> Announce
                </Button>
              )}
            </div>
          </div>

          <SheetFooter className="flex-row items-center justify-between gap-2 border-t px-6 py-4">
            {!isCancelled && !isPast ? (
              <Button type="button" variant="ghost" className="cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setCancelOpen(true)} disabled={busy}>
                <Ban className="mr-2 h-4 w-4" /> Cancel this session
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="cursor-pointer" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>
              {!isCancelled && (
                <Button type="button" className="cursor-pointer" onClick={handleSave} disabled={busy || !dirty || capacity < session.booked_count}>
                  {override.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save for this session
                </Button>
              )}
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={cancelOpen} onOpenChange={(v) => { if (!cancel.isPending) setCancelOpen(v); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {session.name} on {formatIST(session.scheduled_at, { weekday: 'short', day: 'numeric', month: 'short' })}?</AlertDialogTitle>
            <AlertDialogDescription>
              {session.booked_count > 0
                ? `${session.booked_count} booked member${session.booked_count === 1 ? '' : 's'} will be told over the enabled channels and any class credit is returned. Paid bookings are flagged for refund.`
                : 'Nobody has booked yet. The slot disappears from the member timetable; the rule keeps generating other days.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Reason shown to members <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea id="cancel-reason" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Trainer unwell, studio maintenance…" maxLength={240} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Keep session</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void handleCancel(); }} disabled={cancel.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {cancel.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cancel session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
