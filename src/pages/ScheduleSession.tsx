import { useMemo, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { useTrainerData } from '@/hooks/useMemberData';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  Plus,
  Timer,
  User,
} from 'lucide-react';
import { format, setHours, setMinutes, startOfDay } from 'date-fns';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { inr, paymentStateMeta, useTrainerBilling } from '@/hooks/useTrainerBilling';

const cardShell =
  'rounded-2xl border-0 shadow-lg shadow-primary/5 transition-all duration-200 hover:shadow-xl hover:shadow-primary/10 dark:shadow-none';

export default function ScheduleSession() {
  const { trainer, clients, isLoading } = useTrainerData();
  const { data: billingRows = [] } = useTrainerBilling(trainer?.id, !!trainer);

  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState<string>('10:00');
  const [duration, setDuration] = useState<number>(60);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const billingByPackage = useMemo(() => {
    const map: Record<string, (typeof billingRows)[number]> = {};
    billingRows.forEach((r) => { map[r.package_row_id] = r; });
    return map;
  }, [billingRows]);

  const timeSlots = useMemo(() => {
    const slots: string[] = [];
    for (let hour = 6; hour <= 21; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
      slots.push(`${hour.toString().padStart(2, '0')}:30`);
    }
    return slots;
  }, []);

  const activeClient = clients.find((c: any) => c.member_id === selectedClient);
  const clientName = (c: any) =>
    c?.member?.profile?.full_name || c?.member?.member_code || 'Unknown';
  const hasSessions = (c: any) =>
    (c?.package_type ?? 'session_based') === 'monthly' || (c?.sessions_remaining ?? 0) > 0;

  const handleScheduleSession = async () => {
    if (!selectedClient || !selectedDate) {
      toast.error('Please select a client and date');
      return;
    }
    const clientPackage = clients.find((c: any) => c.member_id === selectedClient);
    if (!clientPackage) {
      toast.error('Client package not found');
      return;
    }
    if (!hasSessions(clientPackage)) {
      toast.error('This package has no remaining sessions');
      return;
    }

    setIsSubmitting(true);
    try {
      const [hours, minutes] = selectedTime.split(':').map(Number);
      const scheduledAt = setMinutes(setHours(selectedDate, hours), minutes);

      const { error } = await supabase.from('pt_sessions').insert({
        trainer_id: trainer!.id,
        branch_id: trainer!.branch_id,
        member_pt_package_id: clientPackage.id,
        scheduled_at: scheduledAt.toISOString(),
        duration_minutes: duration,
        status: 'scheduled',
        notes: notes || null,
      });
      if (error) throw error;

      toast.success('Session scheduled');
      setSelectedClient('');
      setSelectedDate(undefined);
      setSelectedTime('10:00');
      setNotes('');
    } catch (error: any) {
      toast.error('Failed to schedule session: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <Skeleton className="h-[520px] rounded-2xl" />
            <Skeleton className="h-[320px] rounded-2xl" />
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!trainer) {
    return (
      <AppLayout>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-10 w-10 text-amber-500" aria-hidden />
          <h1 className="text-xl font-bold">No trainer profile found</h1>
          <p className="text-sm text-muted-foreground">Your account is not linked to a trainer record.</p>
        </div>
      </AppLayout>
    );
  }

  const blocked = !!activeClient && !hasSessions(activeClient);

  return (
    <AppLayout>
      <div className="space-y-6">
        <section className="rounded-2xl bg-gradient-to-r from-primary to-primary/80 p-6 text-primary-foreground shadow-lg">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Plus className="h-7 w-7" aria-hidden />
            Schedule PT Session
          </h1>
          <p className="mt-1 text-sm opacity-85">
            Book a personal training session with one of your clients
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* Composer */}
          <Card className={cardShell}>
            <CardContent className="space-y-6 p-6">
              <div>
                <h2 className="text-lg font-bold text-foreground">Session details</h2>
                <p className="text-sm text-muted-foreground">Fill in the session information</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pt-client" className="flex items-center gap-2">
                  <User className="h-4 w-4" aria-hidden /> Select client
                </Label>
                {clients.length === 0 ? (
                  <div className="rounded-xl bg-muted/50 p-4 text-center text-sm text-muted-foreground">
                    No active PT clients
                  </div>
                ) : (
                  <Select value={selectedClient} onValueChange={setSelectedClient}>
                    <SelectTrigger id="pt-client" className="min-h-[44px] rounded-xl">
                      <SelectValue placeholder="Choose a client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((client: any) => (
                        <SelectItem key={client.member_id} value={client.member_id}>
                          {clientName(client)} · {client.sessions_remaining ?? 0} left
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="pt-date" className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" aria-hidden /> Session date
                </Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      id="pt-date"
                      variant="outline"
                      className="min-h-[44px] w-full justify-start rounded-xl text-left font-normal"
                    >
                      {selectedDate ? (
                        format(selectedDate, 'EEE, dd MMM yyyy')
                      ) : (
                        <span className="text-muted-foreground">Pick a date</span>
                      )}
                      <CalendarDays className="ml-auto h-4 w-4 opacity-50" aria-hidden />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      disabled={(date) => date < startOfDay(new Date())}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pt-time" className="flex items-center gap-2">
                    <Clock className="h-4 w-4" aria-hidden /> Time
                  </Label>
                  <Select value={selectedTime} onValueChange={setSelectedTime}>
                    <SelectTrigger id="pt-time" className="min-h-[44px] rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {timeSlots.map((time) => (
                        <SelectItem key={time} value={time}>{time}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pt-duration" className="flex items-center gap-2">
                    <Timer className="h-4 w-4" aria-hidden /> Duration
                  </Label>
                  <Select value={duration.toString()} onValueChange={(v) => setDuration(Number(v))}>
                    <SelectTrigger id="pt-duration" className="min-h-[44px] rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[30, 45, 60, 90, 120].map((d) => (
                        <SelectItem key={d} value={String(d)}>{d} minutes</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pt-notes">Session notes (optional)</Label>
                <Textarea
                  id="pt-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Focus areas, workout plan, etc."
                  rows={3}
                  className="rounded-xl"
                />
              </div>

              {blocked && (
                <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
                  {clientName(activeClient)} has no sessions left on this package. Ask the front desk
                  to renew or top up before booking.
                </p>
              )}

              <Button
                className="min-h-[44px] w-full rounded-xl"
                onClick={handleScheduleSession}
                disabled={!selectedClient || !selectedDate || isSubmitting || blocked}
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                Schedule session
              </Button>
            </CardContent>
          </Card>

          {/* Summary + roster */}
          <div className="space-y-6">
            {selectedClient && selectedDate && (
              <div className="rounded-2xl bg-gradient-to-r from-primary to-primary/80 p-5 text-primary-foreground shadow-lg">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-80">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Session summary
                </p>
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="opacity-80">Client</dt>
                    <dd className="font-semibold">{clientName(activeClient)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="opacity-80">Date</dt>
                    <dd className="font-semibold">{format(selectedDate, 'EEE, dd MMM yyyy')}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="opacity-80">Time</dt>
                    <dd className="font-semibold">{selectedTime}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="opacity-80">Duration</dt>
                    <dd className="font-semibold">{duration} minutes</dd>
                  </div>
                </dl>
              </div>
            )}

            <Card className={cardShell}>
              <CardContent className="p-5">
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-foreground">Your PT clients</h2>
                  <p className="text-xs text-muted-foreground">
                    {clients.length} active package{clients.length === 1 ? '' : 's'}
                  </p>
                </div>

                {clients.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No active clients</p>
                ) : (
                  <ul className="space-y-2">
                    {clients.map((client: any) => {
                      const name = clientName(client);
                      const selected = selectedClient === client.member_id;
                      const billing = billingByPackage[client.id];
                      const payMeta = billing ? paymentStateMeta(billing.payment_state) : null;
                      const left = client.sessions_remaining ?? 0;
                      return (
                        <li key={client.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedClient(client.member_id)}
                            aria-pressed={selected}
                            className={`w-full min-h-[44px] cursor-pointer rounded-xl p-3 text-left transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ring ${
                              selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/60'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">{name}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {client.member?.member_code} · {client.package?.name}
                                </p>
                              </div>
                              <Badge
                                className={`shrink-0 rounded-full border-0 text-xs ${
                                  left > 3 ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                                }`}
                              >
                                {left} left
                              </Badge>
                            </div>
                            {payMeta && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <Badge className={`rounded-full border-0 text-xs ${payMeta.className}`}>
                                  {payMeta.label}
                                </Badge>
                                {billing!.balance_due > 0 && (
                                  <span className="text-xs font-medium text-red-600">
                                    {inr(billing!.balance_due)} due
                                    {billing!.payment_due_date
                                      ? ` · ${format(new Date(billing!.payment_due_date), 'dd MMM')}`
                                      : ''}
                                  </span>
                                )}
                              </div>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
