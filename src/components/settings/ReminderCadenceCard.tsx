import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { AlarmClock, ArrowRight, CalendarClock, CreditCard, Save, Loader2 } from 'lucide-react';

type Channel = 'whatsapp' | 'sms' | 'email' | 'notification';

const CHANNEL_LABELS: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
  notification: 'In-app',
};

const DAY_OPTIONS = [14, 7, 5, 3, 1, 0];

const REMINDER_TYPES = [
  {
    key: 'membership_expiry',
    title: 'Membership expiry',
    description: 'Renewal nudges before a plan runs out.',
    Icon: CalendarClock,
  },
  {
    key: 'payment_due',
    title: 'Payment dues',
    description: 'Outstanding amount reminders before the due date.',
    Icon: CreditCard,
  },
] as const;

interface ReminderConfigRow {
  id: string;
  branch_id: string;
  reminder_type: string;
  is_enabled: boolean;
  days_before: number[] | null;
  channel: string | null;
  fallback_channels: string[] | null;
}

interface DraftRow {
  is_enabled: boolean;
  days_before: number[];
  channel: Channel;
  fallback_channels: Channel[];
}

type Draft = Record<string, DraftRow>;

const DEFAULT_DRAFT: DraftRow = {
  is_enabled: true,
  days_before: [7, 5, 3],
  channel: 'whatsapp',
  fallback_channels: ['sms', 'email', 'notification'],
};

export function ReminderCadenceCard() {
  const { effectiveBranchId, currentBranchName } = useBranchContext();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reminder-configurations', effectiveBranchId ?? 'all'],
    enabled: Boolean(effectiveBranchId),
    queryFn: async (): Promise<ReminderConfigRow[]> => {
      const { data, error } = await supabase
        .from('reminder_configurations')
        .select('id, branch_id, reminder_type, is_enabled, days_before, channel, fallback_channels')
        .eq('branch_id', effectiveBranchId!)
        .in('reminder_type', ['membership_expiry', 'payment_due']);
      if (error) throw error;
      return (data ?? []) as unknown as ReminderConfigRow[];
    },
  });

  useEffect(() => {
    if (!data) return;
    const next: Draft = {};
    for (const t of REMINDER_TYPES) {
      const row = data.find((r) => r.reminder_type === t.key);
      next[t.key] = row
        ? {
            is_enabled: row.is_enabled ?? true,
            days_before: (row.days_before ?? DEFAULT_DRAFT.days_before).slice().sort((a, b) => b - a),
            channel: (row.channel as Channel) ?? 'whatsapp',
            fallback_channels: ((row.fallback_channels ?? []) as Channel[]).filter(
              (c) => c !== ((row.channel as Channel) ?? 'whatsapp'),
            ),
          }
        : { ...DEFAULT_DRAFT };
    }
    setDraft(next);
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!effectiveBranchId) throw new Error('Pick a branch first');
      for (const t of REMINDER_TYPES) {
        const d = draft[t.key];
        if (!d) continue;
        const existing = data?.find((r) => r.reminder_type === t.key);
        const payload = {
          branch_id: effectiveBranchId,
          reminder_type: t.key,
          is_enabled: d.is_enabled,
          days_before: d.days_before.slice().sort((a, b) => b - a),
          channel: d.channel,
          fallback_channels: d.fallback_channels,
          updated_at: new Date().toISOString(),
        };
        const { error } = existing
          ? await supabase.from('reminder_configurations').update(payload as never).eq('id', existing.id)
          : await supabase.from('reminder_configurations').insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Reminder schedule saved');
      queryClient.invalidateQueries({ queryKey: ['reminder-configurations'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save the reminder schedule'),
  });

  const patch = (key: string, updates: Partial<DraftRow>) =>
    setDraft((prev) => ({ ...prev, [key]: { ...(prev[key] ?? DEFAULT_DRAFT), ...updates } }));

  const chainFor = (d: DraftRow | undefined) => {
    if (!d) return [];
    return [d.channel, ...d.fallback_channels.filter((c) => c !== d.channel)];
  };

  const headerBadge = useMemo(
    () => (currentBranchName ? currentBranchName : 'Select a branch'),
    [currentBranchName],
  );

  return (
    <Card className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
              <AlarmClock className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle>Reminder schedule</CardTitle>
              <CardDescription>
                When expiry and dues reminders go out, and which channels are tried.
              </CardDescription>
            </div>
          </div>
          <Badge className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
            {headerBadge}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {!effectiveBranchId && (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
            Choose a single branch in the header to set its reminder schedule.
          </p>
        )}

        {effectiveBranchId && isLoading && (
          <div className="space-y-4">
            <Skeleton className="h-36 w-full rounded-2xl" />
            <Skeleton className="h-36 w-full rounded-2xl" />
          </div>
        )}

        {effectiveBranchId && isError && (
          <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
            We could not load the reminder schedule. Please refresh and try again.
          </p>
        )}

        {effectiveBranchId &&
          !isLoading &&
          !isError &&
          REMINDER_TYPES.map(({ key, title, description, Icon }) => {
            const d = draft[key] ?? DEFAULT_DRAFT;
            return (
              <section key={key} className="rounded-2xl bg-slate-50 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="rounded-full bg-indigo-50 p-2 text-indigo-600">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                      <p className="text-sm text-slate-500">{description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`${key}-enabled`} className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {d.is_enabled ? 'On' : 'Off'}
                    </Label>
                    <Switch
                      id={`${key}-enabled`}
                      checked={d.is_enabled}
                      onCheckedChange={(v) => patch(key, { is_enabled: v })}
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Days before</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {DAY_OPTIONS.map((day) => {
                        const active = d.days_before.includes(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            aria-pressed={active}
                            disabled={!d.is_enabled}
                            onClick={() =>
                              patch(key, {
                                days_before: active
                                  ? d.days_before.filter((x) => x !== day)
                                  : [...d.days_before, day],
                              })
                            }
                            className={`min-h-[44px] cursor-pointer rounded-xl px-4 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                              active
                                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                                : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
                            }`}
                          >
                            {day === 0 ? 'On the day' : `${day}d`}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Channels tried, in order
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(Object.keys(CHANNEL_LABELS) as Channel[]).map((ch) => {
                        const isPrimary = d.channel === ch;
                        const isFallback = d.fallback_channels.includes(ch);
                        return (
                          <button
                            key={ch}
                            type="button"
                            aria-pressed={isPrimary || isFallback}
                            disabled={!d.is_enabled}
                            onClick={() => {
                              if (isPrimary) return;
                              patch(key, {
                                fallback_channels: isFallback
                                  ? d.fallback_channels.filter((c) => c !== ch)
                                  : [...d.fallback_channels, ch],
                              });
                            }}
                            onDoubleClick={() =>
                              patch(key, {
                                channel: ch,
                                fallback_channels: [
                                  ...d.fallback_channels.filter((c) => c !== ch),
                                  ...(d.channel === ch ? [] : [d.channel]),
                                ],
                              })
                            }
                            className={`min-h-[44px] cursor-pointer rounded-xl px-4 text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 ${
                              isPrimary
                                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                                : isFallback
                                  ? 'bg-indigo-50 text-indigo-700'
                                  : 'bg-white text-slate-500 shadow-sm hover:bg-slate-100'
                            }`}
                          >
                            {CHANNEL_LABELS[ch]}
                            {isPrimary && <span className="ml-1 text-[10px] uppercase tracking-wide">1st</span>}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Tap to add or remove a backup channel, double-tap to make it the first one tried.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white p-3 text-sm text-slate-600 shadow-sm">
                    {chainFor(d).map((ch, i) => (
                      <span key={ch} className="flex items-center gap-1.5">
                        {i > 0 && <ArrowRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />}
                        <span className="font-medium text-slate-900">{CHANNEL_LABELS[ch]}</span>
                      </span>
                    ))}
                    <span className="ml-1 text-slate-500">— first one that gets through wins.</span>
                  </div>
                </div>
              </section>
            );
          })}

        {effectiveBranchId && !isLoading && !isError && (
          <div className="flex justify-end">
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="cursor-pointer rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white focus:ring-2 focus:ring-indigo-500"
            >
              {save.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              Save schedule
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
