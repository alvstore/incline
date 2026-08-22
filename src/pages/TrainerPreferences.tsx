/**
 * TrainerPreferences — trainer-scoped preferences.
 * Communication toggles that actually apply to a coach (task reminders,
 * class notifications, announcements, WhatsApp) + appearance.
 * Admin-only settings (lead rules, system alerts) are intentionally absent.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemePicker } from '@/components/settings/ThemePicker';
import { MyShiftWeekCard } from '@/components/staff/MyShiftWeekCard';
import { useAuth } from '@/contexts/AuthContext';
import { fetchPreferences, upsertPreferences } from '@/services/notificationService';
import { useToast } from '@/hooks/use-toast';
import { Bell, MessageSquare, Palette, CalendarDays } from 'lucide-react';

type PrefKey =
  | 'push_task_reminders'
  | 'whatsapp_task_notifications'
  | 'email_class_notifications'
  | 'email_announcements';

const ROWS: { key: PrefKey; label: string; hint: string }[] = [
  { key: 'push_task_reminders', label: 'Task reminders', hint: 'In-app alerts for tasks assigned to you' },
  { key: 'whatsapp_task_notifications', label: 'WhatsApp task alerts', hint: 'Same task alerts delivered on WhatsApp' },
  { key: 'email_class_notifications', label: 'Class & session updates', hint: 'Schedule changes for your classes and PT sessions' },
  { key: 'email_announcements', label: 'Club announcements', hint: 'Staff announcements from the management team' },
];

export default function TrainerPreferences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    push_task_reminders: true,
    whatsapp_task_notifications: true,
    email_class_notifications: true,
    email_announcements: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['trainer-preferences', user?.id],
    enabled: !!user?.id,
    queryFn: () => fetchPreferences(user!.id),
  });

  useEffect(() => {
    if (!data) return;
    setPrefs((p) => ({
      push_task_reminders: data.push_task_reminders ?? p.push_task_reminders,
      whatsapp_task_notifications: (data as any).whatsapp_task_notifications ?? p.whatsapp_task_notifications,
      email_class_notifications: data.email_class_notifications ?? p.email_class_notifications,
      email_announcements: data.email_announcements ?? p.email_announcements,
    }));
  }, [data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Record<PrefKey, boolean>>) => upsertPreferences(user!.id, patch as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trainer-preferences', user?.id] });
      toast({ title: 'Preferences saved' });
    },
    onError: (e: any) => toast({ title: 'Could not save', description: e.message, variant: 'destructive' }),
  });

  const toggle = (key: PrefKey, value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    save.mutate({ [key]: value });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Preferences</h1>
          <p className="text-sm text-muted-foreground">How Incline reaches you, and how your workspace looks.</p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="rounded-full bg-indigo-50 p-2 text-indigo-600"><Bell className="h-4 w-4" /></span>
                Notifications
              </CardTitle>
              <CardDescription>Only coaching alerts — no admin or lead noise.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)
              ) : (
                ROWS.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-center justify-between gap-4 rounded-xl bg-muted/40 p-3 transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0">
                      <Label htmlFor={row.key} className="cursor-pointer text-sm font-medium">
                        {row.label}
                      </Label>
                      <p className="text-xs text-muted-foreground">{row.hint}</p>
                    </div>
                    <Switch
                      id={row.key}
                      checked={prefs[row.key]}
                      onCheckedChange={(v) => toggle(row.key, v)}
                      disabled={save.isPending}
                    />
                  </div>
                ))
              )}
              <p className="flex items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                <MessageSquare className="h-3 w-3" /> Member enquiries always reach the front desk first.
              </p>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-2xl border-0 shadow-lg shadow-slate-200/50">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className="rounded-full bg-indigo-50 p-2 text-indigo-600"><Palette className="h-4 w-4" /></span>
                  Appearance
                </CardTitle>
                <CardDescription>Theme for your dashboard.</CardDescription>
              </CardHeader>
              <CardContent>
                <ThemePicker />
              </CardContent>
            </Card>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" /> Your roster
              </p>
              <MyShiftWeekCard userId={user?.id} />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
