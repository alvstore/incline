import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Dumbbell, Loader2, Save, UserRound, Users, ShieldCheck } from 'lucide-react';

type Channel = 'notification' | 'email' | 'sms' | 'rcs' | 'whatsapp';
type Audience = 'member' | 'trainer' | 'manager';

const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'notification', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
  { key: 'rcs', label: 'RCS' },
  { key: 'whatsapp', label: 'WhatsApp' },
];
const AUDIENCES: { key: Audience; label: string; hint: string; Icon: typeof UserRound }[] = [
  { key: 'member', label: 'Member', hint: 'The client whose package is ending', Icon: UserRound },
  { key: 'trainer', label: 'Trainer', hint: 'Assigned trainer, to follow up', Icon: Users },
  { key: 'manager', label: 'Branch manager', hint: 'One daily summary, not per client', Icon: ShieldCheck },
];
const DAY_OPTIONS = [14, 7, 5, 3, 1, 0];

interface Settings {
  low_sessions: number;
  audiences: Record<Audience, { enabled: boolean; channels: Channel[] }>;
}
interface Draft { is_enabled: boolean; days_before: number[]; settings: Settings }

const DEFAULT: Draft = {
  is_enabled: true,
  days_before: [7, 3, 1],
  settings: {
    low_sessions: 2,
    audiences: {
      member: { enabled: true, channels: ['notification'] },
      trainer: { enabled: true, channels: ['notification'] },
      manager: { enabled: false, channels: ['notification'] },
    },
  },
};

const chip = (on: boolean) =>
  `min-h-[44px] cursor-pointer rounded-xl px-4 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
    on ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground hover:bg-secondary'
  }`;

export function PtExpiryReminderCard() {
  const { effectiveBranchId } = useBranchContext();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(DEFAULT);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['reminder-configurations', 'pt_expiry', effectiveBranchId],
    enabled: Boolean(effectiveBranchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reminder_configurations')
        .select('id, is_enabled, days_before, settings')
        .eq('branch_id', effectiveBranchId!)
        .eq('reminder_type', 'pt_expiry')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!data) { setDraft(DEFAULT); return; }
    const s = (data.settings ?? {}) as Partial<Settings>;
    setDraft({
      is_enabled: data.is_enabled ?? true,
      days_before: data.days_before ?? DEFAULT.days_before,
      settings: {
        low_sessions: typeof s.low_sessions === 'number' ? s.low_sessions : 2,
        audiences: { ...DEFAULT.settings.audiences, ...(s.audiences ?? {}) },
      },
    });
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        branch_id: effectiveBranchId!,
        reminder_type: 'pt_expiry',
        is_enabled: draft.is_enabled,
        days_before: [...draft.days_before].sort((a, b) => b - a),
        channel: 'notification',
        settings: draft.settings as never,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('reminder_configurations')
        .upsert(payload as never, { onConflict: 'branch_id,reminder_type' });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('PT reminders saved');
      qc.invalidateQueries({ queryKey: ['reminder-configurations'] });
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save PT reminders'),
  });

  const setAud = (a: Audience, u: Partial<Settings['audiences'][Audience]>) =>
    setDraft((d) => ({ ...d, settings: { ...d.settings, audiences: { ...d.settings.audiences, [a]: { ...d.settings.audiences[a], ...u } } } }));

  if (!effectiveBranchId) return null;

  return (
    <Card className="rounded-2xl border-0 bg-card shadow-lg shadow-foreground/5">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/10 p-2 text-primary"><Dumbbell className="h-5 w-5" aria-hidden /></span>
            <div>
              <CardTitle className="text-base font-semibold tracking-tight">PT package expiry</CardTitle>
              <CardDescription className="text-xs">Utility alerts so member and trainer can follow up before a PT package ends.</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="pt-expiry-enabled" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{draft.is_enabled ? 'On' : 'Off'}</Label>
            <Switch id="pt-expiry-enabled" checked={draft.is_enabled} onCheckedChange={(v) => setDraft((d) => ({ ...d, is_enabled: v }))} aria-label="PT package expiry reminders" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? <Skeleton className="h-48 w-full rounded-2xl" /> : isError ? (
          <p className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">Could not load PT reminder settings. Please refresh.</p>
        ) : (
          <>
            <fieldset disabled={!draft.is_enabled} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-12">
                <div className="md:col-span-8">
                  <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Days before expiry</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {DAY_OPTIONS.map((day) => {
                      const on = draft.days_before.includes(day);
                      return (
                        <button key={day} type="button" aria-pressed={on} className={chip(on)}
                          onClick={() => setDraft((d) => ({ ...d, days_before: on ? d.days_before.filter((x) => x !== day) : [...d.days_before, day] }))}>
                          {day === 0 ? 'On the day' : `${day}d`}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="md:col-span-4">
                  <Label htmlFor="pt-low" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Low sessions alert</Label>
                  <div className="mt-2 flex items-center gap-2">
                    <input id="pt-low" type="number" min={0} max={10} value={draft.settings.low_sessions}
                      onChange={(e) => setDraft((d) => ({ ...d, settings: { ...d.settings, low_sessions: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } }))}
                      className="h-11 w-20 rounded-xl border border-border bg-card px-3 text-sm tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                    <span className="text-sm text-muted-foreground">sessions left (0 = off)</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {AUDIENCES.map(({ key, label, hint, Icon }) => {
                  const a = draft.settings.audiences[key];
                  return (
                    <section key={key} className="rounded-2xl bg-muted/50 p-4" aria-labelledby={`pt-aud-${key}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <Icon className="mt-0.5 h-4 w-4 text-primary" aria-hidden />
                          <div>
                            <h3 id={`pt-aud-${key}`} className="text-sm font-semibold">{label}</h3>
                            <p className="text-xs text-muted-foreground">{hint}</p>
                          </div>
                        </div>
                        <Switch checked={a.enabled} onCheckedChange={(v) => setAud(key, { enabled: v })} aria-label={`Notify ${label}`} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`${label} channels`}>
                        {CHANNELS.map((c) => {
                          const on = a.channels.includes(c.key);
                          return (
                            <button key={c.key} type="button" aria-pressed={on} disabled={!a.enabled} className={chip(on)}
                              onClick={() => setAud(key, { channels: on ? a.channels.filter((x) => x !== c.key) : [...a.channels, c.key] })}>
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                      {a.enabled && a.channels.length === 0 && <p className="mt-2 text-xs text-destructive">Pick at least one channel.</p>}
                    </section>
                  );
                })}
              </div>

              <p className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
                Example: “Rahul's PT package Silver Package ends on 12 Nov (4 sessions left). Please follow up.” Skipped when the member already has a next PT package.
                WhatsApp, SMS and RCS need an approved template for these events in Communication Templates.
              </p>
            </fieldset>
            <div className="flex justify-end">
              <Button onClick={() => save.mutate()} disabled={save.isPending} className="min-h-11 rounded-xl">
                {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}
                Save PT reminders
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
