import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LeadNotificationCards,
  AdminRecipientsCard,
  type LeadNotificationCardsHandle,
} from '@/components/settings/LeadNotificationSettings';
import { ReminderCadenceCard } from '@/components/settings/ReminderCadenceCard';
import { PtExpiryReminderCard } from '@/components/settings/PtExpiryReminderCard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Mail, Bell, Save, Loader2, MessageCircle, AlertTriangle, RotateCcw, AlarmClock, Users, UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPreferences, upsertPreferences } from '@/services/notificationService';
import { toast } from 'sonner';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
  SettingsCard, GroupLabel, ToggleRow, StatusBadge, settingsCardClass,
} from '@/components/settings/notifications/primitives';

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
  { key: 'email_class_notifications', label: 'Class bookings', hint: 'Class booking confirmations' },
  { key: 'email_announcements', label: 'Announcements', hint: 'Gym announcements by email' },
];
const INAPP_ROWS: RowDef[] = [
  { key: 'push_low_stock', label: 'Low stock', hint: 'When store inventory runs low' },
  { key: 'push_new_leads', label: 'New leads', hint: 'When a new enquiry arrives' },
  { key: 'push_payment_alerts', label: 'Overdue payments', hint: 'When member dues become overdue' },
  { key: 'push_task_reminders', label: 'Task reminders', hint: 'Due and assigned tasks' },
];
const WA_ROWS: RowDef[] = [
  { key: 'whatsapp_task_notifications', label: 'Task alerts', hint: 'Task alerts to owners and admins' },
];

const SECTIONS = [
  { value: 'reminders', label: 'Reminders', icon: AlarmClock },
  { value: 'members', label: 'Member messages', icon: Mail },
  { value: 'team', label: 'Team alerts', icon: Users },
  { value: 'leads', label: 'Lead alerts', icon: UserPlus },
] as const;
type Section = (typeof SECTIONS)[number]['value'];
const isSection = (v: string | null): v is Section => SECTIONS.some((s) => s.value === v);

function countOn(p: Prefs, rows: RowDef[]) {
  return rows.filter((r) => p[r.key]).length;
}

function BulkButton({ rows, prefs, onBulk }: { rows: RowDef[]; prefs: Prefs; onBulk: (k: PrefKey[], v: boolean) => void }) {
  const allOn = countOn(prefs, rows) === rows.length;
  return (
    <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onBulk(rows.map((r) => r.key), !allOn)}>
      {allOn ? 'Turn all off' : 'Turn all on'}
    </Button>
  );
}

function StatTile({ icon: Icon, label, value, active, onClick }: {
  icon: LucideIcon; label: string; value: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        settingsCardClass,
        'col-span-6 flex min-h-11 cursor-pointer items-center gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:col-span-3',
        active && 'ring-2 ring-primary/40',
      )}
    >
      <span className="rounded-full bg-primary/10 p-2 text-primary" aria-hidden="true"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="block text-lg font-semibold tabular-nums text-foreground">{value}</span>
      </span>
    </button>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading notification settings">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-12 gap-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="col-span-6 h-20 rounded-2xl lg:col-span-3" />)}
      </div>
      <Card className={cn(settingsCardClass, 'space-y-4 p-5')}>
        <Skeleton className="h-6 w-40" />
        {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-10 w-full" />)}
      </Card>
    </div>
  );
}

export function NotificationSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const section: Section = isSection(sectionParam) ? sectionParam : 'reminders';

  const [preferences, setPreferences] = useState<Prefs>(DEFAULTS);
  const [baseline, setBaseline] = useState<Prefs>(DEFAULTS);
  const [leadDirty, setLeadDirty] = useState(false);
  const [liveMsg, setLiveMsg] = useState('');
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

  const changedCount = useMemo(
    () => (Object.keys(DEFAULTS) as PrefKey[]).filter((k) => preferences[k] !== baseline[k]).length,
    [preferences, baseline],
  );
  const dirty = changedCount > 0 || leadDirty;

  const saveMutation = useMutation({
    mutationFn: async () => {
      await Promise.all([
        changedCount > 0 ? upsertPreferences(user!.id, preferences) : Promise.resolve(),
        leadDirty ? leadCardsRef.current?.save() ?? Promise.resolve() : Promise.resolve(),
      ]);
    },
    onSuccess: () => {
      track('notification_settings_saved', { changed_count: changedCount + (leadDirty ? 1 : 0), section });
      setBaseline(preferences);
      setLiveMsg('Notification settings saved');
      toast.success('Notification settings saved');
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
    onError: () => {
      setLiveMsg('Saving failed. Please try again.');
      toast.error('Could not save. Please try again.');
    },
  });

  const set = (key: PrefKey, v: boolean) => setPreferences((p) => ({ ...p, [key]: v }));
  const bulk = (keys: PrefKey[], v: boolean) =>
    setPreferences((p) => ({ ...p, ...Object.fromEntries(keys.map((k) => [k, v])) }));

  const changeSection = useCallback((v: string) => {
    if (!isSection(v)) return;
    const next = new URLSearchParams(searchParams);
    next.set('section', v);
    setSearchParams(next, { replace: true });
    track('notification_section_viewed', { section: v });
  }, [searchParams, setSearchParams]);

  if (isLoading) return <LoadingState />;

  if (isError) {
    return (
      <Card className={cn(settingsCardClass, 'p-8 text-center')}>
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
        <p className="font-medium text-foreground">We couldn't load your notification settings.</p>
        <Button variant="outline" className="mt-4" onClick={() => refetch()}>
          <RotateCcw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </Card>
    );
  }

  const teamRows = [...INAPP_ROWS, ...WA_ROWS];
  const saveButton = (
    <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending} className="min-h-11">
      {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      {saveMutation.isPending ? 'Saving…' : 'Save changes'}
    </Button>
  );

  return (
    <div className="space-y-5 pb-24 md:pb-0">
      <p className="sr-only" aria-live="polite">{liveMsg}</p>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Notifications</h2>
          <p className="text-sm text-muted-foreground">Choose who gets told what, and on which channel.</p>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          {dirty ? <StatusBadge tone="warn">Unsaved changes</StatusBadge> : <StatusBadge tone="on">All saved</StatusBadge>}
          {saveButton}
        </div>
      </div>

      <div className="hidden grid-cols-12 gap-4 sm:grid">
        <StatTile icon={AlarmClock} label="Reminders" value="Schedule" active={section === 'reminders'} onClick={() => changeSection('reminders')} />
        <StatTile icon={Mail} label="Member messages" value={`${countOn(preferences, EMAIL_ROWS)}/${EMAIL_ROWS.length} on`} active={section === 'members'} onClick={() => changeSection('members')} />
        <StatTile icon={Users} label="Team alerts" value={`${countOn(preferences, teamRows)}/${teamRows.length} on`} active={section === 'team'} onClick={() => changeSection('team')} />
        <StatTile icon={UserPlus} label="Lead alerts" value="Lead & team" active={section === 'leads'} onClick={() => changeSection('leads')} />
      </div>

      <Tabs value={section} onValueChange={changeSection}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-muted p-1 sm:w-auto">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.value} value={s.value} className="min-h-10 gap-1.5 rounded-lg px-3">
              <s.icon className="h-4 w-4" aria-hidden="true" /> {s.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="reminders" className="mt-5">
          <div className="space-y-5"><ReminderCadenceCard />
          <PtExpiryReminderCard /></div>
        </TabsContent>

        <TabsContent value="members" className="mt-5">
          <div className="grid grid-cols-12 items-start gap-5">
            <SettingsCard
              className="col-span-12 lg:col-span-8"
              icon={Mail}
              title="Email to members"
              description={`Messages members receive by email · ${countOn(preferences, EMAIL_ROWS)}/${EMAIL_ROWS.length} on`}
              action={<BulkButton rows={EMAIL_ROWS} prefs={preferences} onBulk={bulk} />}
            >
              {EMAIL_ROWS.map((r) => <ToggleRow key={r.key} label={r.label} hint={r.hint} checked={preferences[r.key]} onChange={(v) => set(r.key, v)} />)}
            </SettingsCard>
            <Card className={cn(settingsCardClass, 'col-span-12 space-y-2 p-5 lg:col-span-4')}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Good to know</p>
              <p className="text-sm text-foreground">WhatsApp, SMS and in-app reminders follow the Reminders schedule.</p>
              <p className="text-sm text-muted-foreground">Members can still opt out of marketing messages themselves.</p>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="team" className="mt-5">
          <SettingsCard
            icon={Bell}
            title="Alerts for your staff"
            description={`${countOn(preferences, teamRows)}/${teamRows.length} on`}
            action={<BulkButton rows={teamRows} prefs={preferences} onBulk={bulk} />}
          >
            <div className="grid gap-x-6 md:grid-cols-2">
              <div>
                <GroupLabel icon={Bell}>In-app</GroupLabel>
                {INAPP_ROWS.map((r) => <ToggleRow key={r.key} label={r.label} hint={r.hint} checked={preferences[r.key]} onChange={(v) => set(r.key, v)} />)}
              </div>
              <div>
                <GroupLabel icon={MessageCircle}>WhatsApp</GroupLabel>
                {WA_ROWS.map((r) => <ToggleRow key={r.key} label={r.label} hint={r.hint} checked={preferences[r.key]} onChange={(v) => set(r.key, v)} />)}
              </div>
            </div>
          </SettingsCard>
        </TabsContent>

        {/* forceMount keeps unsaved lead edits when switching sections */}
        <TabsContent value="leads" forceMount className="mt-5 space-y-5 data-[state=inactive]:hidden">
          <div className="grid grid-cols-12 items-start gap-5">
            <LeadNotificationCards ref={leadCardsRef} onDirtyChange={setLeadDirty} />
          </div>
          <AdminRecipientsCard />
        </TabsContent>
      </Tabs>

      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-3 pb-safe md:hidden">
        {dirty ? <StatusBadge tone="warn">Unsaved changes</StatusBadge> : <StatusBadge tone="on">All saved</StatusBadge>}
        {saveButton}
      </div>
    </div>
  );
}
