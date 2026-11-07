import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useBranchContext } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserCheck, Users, ShieldCheck, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { track } from '@/lib/analytics';
import { SettingsCard, GroupLabel, ToggleRow, settingsCardClass } from '@/components/settings/notifications/primitives';

type LeadRulesForm = {
  sms_to_lead: boolean;
  whatsapp_to_lead: boolean;
  email_to_lead: boolean;
  sms_to_admins: boolean;
  whatsapp_to_admins: boolean;
  email_to_admins: boolean;
  sms_to_managers: boolean;
  whatsapp_to_managers: boolean;
  email_to_managers: boolean;
  lead_welcome_sms: string;
  lead_welcome_whatsapp: string;
  team_alert_sms: string;
  team_alert_whatsapp: string;
};

const DEFAULTS: LeadRulesForm = {
  sms_to_lead: false,
  whatsapp_to_lead: false,
  email_to_lead: false,
  sms_to_admins: false,
  whatsapp_to_admins: false,
  email_to_admins: false,
  sms_to_managers: false,
  whatsapp_to_managers: false,
  email_to_managers: false,
  lead_welcome_sms: 'Hi {{lead_name}}, thank you for your interest in {{branch_name}}! We will contact you shortly.',
  lead_welcome_whatsapp: 'Hi {{lead_name}}, welcome to {{branch_name}}! 🏋️ Our team will reach out to you soon.',
  team_alert_sms: 'New lead: {{lead_name}} ({{lead_phone}}) from {{lead_source}} at {{branch_name}}',
  team_alert_whatsapp: '🔔 New Lead Alert\nName: {{lead_name}}\nPhone: {{lead_phone}}\nSource: {{lead_source}}\nBranch: {{branch_name}}',
};

export type LeadNotificationCardsHandle = {
  save: () => Promise<void>;
  isDirty: () => boolean;
};

type BoolField = { [K in keyof LeadRulesForm]: LeadRulesForm[K] extends boolean ? K : never }[keyof LeadRulesForm];

type Props = {
  /** Set of cards to render. Defaults to both. */
  variant?: 'lead' | 'team' | 'both';
  onDirtyChange?: (dirty: boolean) => void;
};

/**
 * Renders Lead Alerts + Team Alerts cards that visually match
 * the Email Notifications & System Alerts cards on the same page.
 *
 * Use the returned ref's `save()` to persist (called by the page's Save Preferences).
 */
export const LeadNotificationCards = forwardRef<LeadNotificationCardsHandle, Props>(
  function LeadNotificationCards({ variant = 'both', onDirtyChange }, ref) {
    const { selectedBranch } = useBranchContext();
    const queryClient = useQueryClient();
    const branchId = selectedBranch !== 'all' ? selectedBranch : null;

    const { data: rules, isLoading } = useQuery({
      queryKey: ['lead-notification-rules', branchId],
      queryFn: async () => {
        if (branchId) {
          const { data } = await supabase
            .from('lead_notification_rules')
            .select('*')
            .eq('branch_id', branchId)
            .maybeSingle();
          if (data) return data;
        }
        const { data } = await supabase
          .from('lead_notification_rules')
          .select('*')
          .is('branch_id', null)
          .maybeSingle();
        return data;
      },
    });

    const [form, setForm] = useState<LeadRulesForm>(DEFAULTS);
    const [baseline, setBaseline] = useState<LeadRulesForm>(DEFAULTS);
    const dirty = (Object.keys(form) as (keyof LeadRulesForm)[]).some((k) => form[k] !== baseline[k]);
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

    useEffect(() => {
      if (rules) {
        const r = rules as typeof rules & { email_to_lead?: boolean; email_to_admins?: boolean; email_to_managers?: boolean };
        const next: LeadRulesForm = {
          sms_to_lead: rules.sms_to_lead ?? false,
          whatsapp_to_lead: rules.whatsapp_to_lead ?? false,
          email_to_lead: r.email_to_lead ?? false,
          sms_to_admins: rules.sms_to_admins ?? false,
          whatsapp_to_admins: rules.whatsapp_to_admins ?? false,
          email_to_admins: r.email_to_admins ?? false,
          sms_to_managers: rules.sms_to_managers ?? false,
          whatsapp_to_managers: rules.whatsapp_to_managers ?? false,
          email_to_managers: r.email_to_managers ?? false,
          lead_welcome_sms: rules.lead_welcome_sms || DEFAULTS.lead_welcome_sms,
          lead_welcome_whatsapp: rules.lead_welcome_whatsapp || DEFAULTS.lead_welcome_whatsapp,
          team_alert_sms: rules.team_alert_sms || DEFAULTS.team_alert_sms,
          team_alert_whatsapp: rules.team_alert_whatsapp || DEFAULTS.team_alert_whatsapp,
        };
        setForm(next);
        setBaseline(next);
      }
    }, [rules]);

    const save = async () => {
      const payload = { ...form, branch_id: branchId || null };
      if (rules?.id) {
        const isMatchingBranch = rules.branch_id === branchId;
        if (isMatchingBranch || (!branchId && !rules.branch_id)) {
          const { error } = await supabase.from('lead_notification_rules').update(payload).eq('id', rules.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('lead_notification_rules').upsert(payload, { onConflict: 'branch_id' });
          if (error) throw error;
        }
      } else {
        const { error } = await supabase.from('lead_notification_rules').insert(payload);
        if (error) throw error;
      }
      setBaseline(form);
      queryClient.invalidateQueries({ queryKey: ['lead-notification-rules'] });
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useImperativeHandle(ref, () => ({ save, isDirty: () => dirty }), [form, rules, branchId, dirty]);

    const toggle = (field: BoolField) => {
      setForm((prev) => ({ ...prev, [field]: !prev[field] }));
    };

    if (isLoading) {
      const count = variant === 'both' ? 2 : 1;
      return (
        <>
          {Array.from({ length: count }).map((_, i) => (
            <Card key={i} className={cn(settingsCardClass, 'col-span-12 space-y-3 p-5 lg:col-span-6')}>
              <Skeleton className="h-6 w-48" />
              {[1, 2, 3].map((j) => <Skeleton key={j} className="h-10 w-full" />)}
            </Card>
          ))}
        </>
      );
    }

    const showLead = variant === 'both' || variant === 'lead';
    const showTeam = variant === 'both' || variant === 'team';
    const row = (field: BoolField, label: string, hint: string) => (
      <ToggleRow key={field} label={label} hint={hint} checked={form[field]} onChange={() => toggle(field)} />
    );

    return (
      <>
        {showLead && (
          <SettingsCard
            className="col-span-12 lg:col-span-6"
            icon={UserCheck}
            title="Message the lead"
            description="Welcome message when a new enquiry is captured"
          >
            {row('sms_to_lead', 'SMS', 'Welcome SMS to the lead')}
            {row('whatsapp_to_lead', 'WhatsApp', 'Welcome WhatsApp message to the lead')}
            {row('email_to_lead', 'Email', 'Branded welcome email to the lead')}
          </SettingsCard>
        )}

        {showTeam && (
          <SettingsCard
            className="col-span-12 lg:col-span-6"
            icon={Users}
            title="Alert your team"
            description="Tell owners, admins and managers about new leads"
          >
            <GroupLabel>Owners &amp; admins</GroupLabel>
            {row('sms_to_admins', 'SMS', 'Text message alert')}
            {row('whatsapp_to_admins', 'WhatsApp', 'Approved template, delivers anytime')}
            {row('email_to_admins', 'Email', 'Email alert')}
            <GroupLabel>Branch managers</GroupLabel>
            {row('sms_to_managers', 'SMS', 'Text message alert')}
            {row('whatsapp_to_managers', 'WhatsApp', 'Approved template, delivers anytime')}
            {row('email_to_managers', 'Email', 'Email alert')}
            <p className="mx-3 mt-3 rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Team WhatsApp alerts use an approved template, so they arrive even outside the 24-hour chat window.
            </p>
          </SettingsCard>
        )}
      </>
    );
  }
);

// === Per-admin recipient toggles — full-width card ===
interface AdminRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
}

function maskPhone(p: string | null): string {
  if (!p) return '—';
  const digits = p.replace(/\D/g, '');
  if (digits.length < 4) return p;
  return `${p.slice(0, p.length - digits.length + 2)}•••${digits.slice(-2)}`;
}

type Channel = 'whatsapp_enabled' | 'sms_enabled' | 'email_enabled';
const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'whatsapp_enabled', label: 'WhatsApp' },
  { key: 'sms_enabled', label: 'SMS' },
  { key: 'email_enabled', label: 'Email' },
];

interface ProfileRow { id: string; full_name: string | null; phone: string | null; email: string | null }
interface PrefRow { user_id: string; whatsapp_enabled: boolean; sms_enabled: boolean; email_enabled: boolean | null }

export function AdminRecipientsCard() {
  const queryClient = useQueryClient();
  const { data: admins, isLoading, isError, refetch } = useQuery({
    queryKey: ['lead-notification-admin-recipients'],
    queryFn: async (): Promise<AdminRow[]> => {
      const { data: roleRows, error: rErr } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['owner', 'admin']);
      if (rErr) throw rErr;
      const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id as string)));
      if (ids.length === 0) return [];

      const [{ data: profiles, error: pErr }, { data: prefs }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, phone, email').in('id', ids),
        supabase
          .from('lead_notification_admin_prefs')
          .select('user_id, whatsapp_enabled, sms_enabled, email_enabled')
          .in('user_id', ids),
      ]);
      if (pErr) throw pErr;

      const prefMap = new Map<string, PrefRow>();
      for (const p of (prefs ?? []) as PrefRow[]) prefMap.set(p.user_id, p);

      return ((profiles ?? []) as ProfileRow[]).map((p) => {
        const pref = prefMap.get(p.id);
        return {
          id: p.id,
          full_name: p.full_name,
          phone: p.phone,
          email: p.email ?? null,
          whatsapp_enabled: pref?.whatsapp_enabled ?? true,
          sms_enabled: pref?.sms_enabled ?? true,
          email_enabled: pref?.email_enabled ?? true,
        };
      });
    },
  });

  const updatePref = useMutation({
    mutationFn: async (input: { row: AdminRow; channel: Channel; value: boolean }) => {
      const { row, channel, value } = input;
      const payload = {
        user_id: row.id,
        whatsapp_enabled: channel === 'whatsapp_enabled' ? value : row.whatsapp_enabled,
        sms_enabled: channel === 'sms_enabled' ? value : row.sms_enabled,
        email_enabled: channel === 'email_enabled' ? value : row.email_enabled,
      };
      const { error } = await supabase.from('lead_notification_admin_prefs').upsert(
        payload,
        { onConflict: 'user_id' },
      );
      if (error) throw error;
    },
    onMutate: async ({ row, channel, value }) => {
      const key = ['lead-notification-admin-recipients'];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<AdminRow[]>(key);
      queryClient.setQueryData<AdminRow[]>(key, (old) =>
        (old ?? []).map((a) => (a.id === row.id ? { ...a, [channel]: value } : a)));
      return { prev };
    },
    onSuccess: (_d, { channel, value }) =>
      track('notification_recipient_toggled', { channel: channel.replace('_enabled', ''), enabled: value }),
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['lead-notification-admin-recipients'], ctx.prev);
      toast.error('Could not update this recipient. Please try again.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['lead-notification-admin-recipients'] }),
  });

  return (
    <SettingsCard
      icon={ShieldCheck}
      title="Lead alert recipients"
      description="Which owners and admins get lead alerts. The team switches above must also be on."
      action={
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
          <Zap className="h-3 w-3" aria-hidden="true" /> Saves instantly
        </span>
      }
    >
      {isLoading ? (
        <div className="space-y-2 px-3">
          {[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : isError ? (
        <div className="px-3 py-4 text-sm text-muted-foreground">
          We couldn't load recipients.{' '}
          <button type="button" onClick={() => refetch()} className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            Retry
          </button>
        </div>
      ) : !admins || admins.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
          <Users className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No owners or admins yet. Add one from Staff to receive lead alerts.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {admins.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{a.full_name || 'Unnamed'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {maskPhone(a.phone)}
                  {a.email ? <span> · {a.email}</span> : null}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((c) => (
                  <label
                    key={c.key}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-secondary"
                  >
                    {c.label}
                    <Switch
                      aria-label={`${c.label} lead alerts for ${a.full_name || 'this admin'}`}
                      checked={a[c.key]}
                      onCheckedChange={(v) => updatePref.mutate({ row: a, channel: c.key, value: v })}
                    />
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

// Backwards-compat: any other importer of LeadNotificationSettings still works.
export function LeadNotificationSettings() {
  return (
    <div className="grid grid-cols-12 gap-5">
      <LeadNotificationCards />
    </div>
  );
}
