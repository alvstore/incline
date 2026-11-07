import { useState, useEffect, useRef, useMemo, useId } from 'react';
import {
  LeadNotificationCards,
  AdminRecipientsCard,
  type LeadNotificationCardsHandle,
} from '@/components/settings/LeadNotificationSettings';
import { ReminderCadenceCard } from '@/components/settings/ReminderCadenceCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Mail, Bell, Save, Loader2, MessageCircle, AlertTriangle, RotateCcw, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPreferences, upsertPreferences } from '@/services/notificationService';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const DEFAULTS = {
  email_membership_reminders: true,
  email_payment_receipts: true,
  email_class_notifications: true,
  email_announcements: true,
  push_low_stock: true,
  push_new_leads: true,
  push_payment_alerts: true,
  push_task_reminders: true,
  whatsapp_task_notifications: true,
};
type Prefs = typeof DEFAULTS;
type PrefKey = keyof Prefs;

interface RowDef { key: PrefKey; label: string; hint: string }

const EMAIL_ROWS: RowDef[] = [
  { key: 'email_membership_reminders', label: 'Membership reminders', hint: 'Expiry reminders to members' },
  { key: 'email_payment_receipts', label: 'Payment receipts', hint: 'Receipt after every payment' },
  { key: 'email_class_notifications', label: 'Class notifications', hint: 'Class booking confirmations' },
  { key: 'email_announcements', label: 'Announcements', hint: 'Gym announcements by email' },
];
const INAPP_ROWS: RowDef[] = [
  { key: 'push_low_stock', label: 'Low stock', hint: 'When store inventory runs low' },
  { key: 'push_new_leads', label: 'New leads', hint: 'When a new enquiry arrives' },
  { key: 'push_payment_alerts', label: 'Overdue payments', hint: 'When member dues become overdue' },
  { key: 'push_task_reminders', label: 'Task reminders', hint: 'Due and assigned tasks' },
];
const WA_ROWS: RowDef[] = [
  { key: 'whatsapp_task_notifications', label: 'Task alerts', hint: 'Send task alerts to owners and admins' },
];

function ToggleRow({ row, checked, onChange }: { row: RowDef; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex min-h-[52px] cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-secondary"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{row.label}</span>
        <span className="block text-xs text-muted-foreground">{row.hint}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function SectionLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {children}
    </p>
  );
}

function ChannelCard({
  icon: Icon, title, description, keys, prefs, onBulk, children,
}: {
  icon: LucideIcon; title: string; description: string; keys: PrefKey[]; prefs: Prefs;
  onBulk: (keys: PrefKey[], v: boolean) => void; children: React.ReactNode;
}) {
  const on = keys.filter((k) => prefs[k]).length;
  const allOn = on === keys.length;
  return (
    <Card className="col-span-12 rounded-2xl lg:col-span-6">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></span>
          <div>
            <CardTitle className="text-base font-semibold tracking-tight">{title}</CardTitle>
            <CardDescription className="text-xs">{description} · {on}/{keys.length} on</CardDescription>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onBulk(keys, !allOn)}>
          {allOn ? 'Turn all off' : 'Turn all on'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-0.5 px-3 pb-4">{children}</CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-12 gap-5">
        {[0, 1].map((i) => (
          <Card key={i} className="col-span-12 rounded-2xl p-5 lg:col-span-6 space-y-4">
            <Skeleton className="h-6 w-40" />
            {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-10 w-full" />)}
          </Card>
        ))}
      </div>
    </div>
  );
}

export function NotificationSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<Prefs>(DEFAULTS);
  const [baseline, setBaseline] = useState<Prefs>(DEFAULTS);
  const leadCardsRef = useRef<LeadNotificationCardsHandle>(null);

  const { data: saved, isLoading, isError, refetch } = useQuery({
    queryKey: ['notification-preferences', user?.id],
    queryFn: () => fetchPreferences(user!.id),
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (!saved) return;
    const next = (Object.keys(DEFAULTS) as PrefKey[]).reduce((acc, k) => {
      const v = saved[k];
      acc[k] = typeof v === 'boolean' ? v : DEFAULTS[k];
      return acc;
    }, {} as Prefs);
    setPreferences(next);
    setBaseline(next);
  }, [saved]);

  const dirty = useMemo(
    () => (Object.keys(DEFAULTS) as PrefKey[]).some((k) => preferences[k] !== baseline[k]),
    [preferences, baseline],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        upsertPreferences(user!.id, preferences),
        leadCardsRef.current?.save() ?? Promise.resolve(),
      ]);
    },
    onSuccess: () => {
      toast.success('Notification preferences saved');
      setBaseline(preferences);
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
      queryClient.invalidateQueries({ queryKey: ['lead-notification-rules'] });
    },
    onError: () => toast.error('Could not save preferences. Please try again.'),
  });

  const set = (key: PrefKey, v: boolean) => setPreferences((p) => ({ ...p, [key]: v }));
  const bulk = (keys: PrefKey[], v: boolean) =>
    setPreferences((p) => ({ ...p, ...Object.fromEntries(keys.map((k) => [k, v])) }));

  if (isLoading) return <LoadingState />;

  if (isError) {
    return (
      <Card className="rounded-2xl p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
        <p className="font-medium text-foreground">We couldn't load your notification settings.</p>
        <Button variant="outline" className="mt-4" onClick={() => refetch()}>
          <RotateCcw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </Card>
    );
  }

  const saveButton = (
    <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
      {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      {saveMutation.isPending ? 'Saving…' : 'Save changes'}
    </Button>
  );

  return (
    <div className="space-y-5 pb-20 md:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Notifications</h2>
          <p className="text-sm text-muted-foreground">Choose which alerts go out by email, in-app and WhatsApp.</p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          {dirty && (
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-500">
              Unsaved changes
            </span>
          )}
          {saveButton}
        </div>
      </div>

      <ReminderCadenceCard />

      <div className="grid grid-cols-12 gap-5">
        <ChannelCard
          icon={Mail} title="Email" description="Messages sent to members"
          keys={EMAIL_ROWS.map((r) => r.key)} prefs={preferences} onBulk={bulk}
        >
          {EMAIL_ROWS.map((r) => <ToggleRow key={r.key} row={r} checked={preferences[r.key]} onChange={(v) => set(r.key, v)} />)}
        </ChannelCard>

        <ChannelCard
          icon={Bell} title="Team alerts" description="Alerts for your staff"
          keys={[...INAPP_ROWS, ...WA_ROWS].map((r) => r.key)} prefs={preferences} onBulk={bulk}
        >
          <SectionLabel icon={Bell}>In-app</SectionLabel>
          {INAPP_ROWS.map((r) => <ToggleRow key={r.key} row={r} checked={preferences[r.key]} onChange={(v) => set(r.key, v)} />)}
          <SectionLabel icon={MessageCircle}>WhatsApp</SectionLabel>
          {WA_ROWS.map((r) => <ToggleRow key={r.key} row={r} checked={preferences[r.key]} onChange={(v) => set(r.key, v)} />)}
        </ChannelCard>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <LeadNotificationCards ref={leadCardsRef} />
      </div>

      <AdminRecipientsCard />

      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-safe md:hidden">
        <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        {saveButton}
      </div>
    </div>
  );
}
