import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useBranchContext } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserCheck, Users, ShieldCheck } from 'lucide-react';

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
};

type Props = {
  /** Set of cards to render. Defaults to both. */
  variant?: 'lead' | 'team' | 'both';
};

/**
 * Renders Lead Alerts + Team Alerts cards that visually match
 * the Email Notifications & System Alerts cards on the same page.
 *
 * Use the returned ref's `save()` to persist (called by the page's Save Preferences).
 */
export const LeadNotificationCards = forwardRef<LeadNotificationCardsHandle, Props>(
  function LeadNotificationCards({ variant = 'both' }, ref) {
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

    useEffect(() => {
      if (rules) {
        setForm({
          sms_to_lead: rules.sms_to_lead ?? false,
          whatsapp_to_lead: rules.whatsapp_to_lead ?? false,
          email_to_lead: (rules as any).email_to_lead ?? false,
          sms_to_admins: rules.sms_to_admins ?? false,
          whatsapp_to_admins: rules.whatsapp_to_admins ?? false,
          email_to_admins: (rules as any).email_to_admins ?? false,
          sms_to_managers: rules.sms_to_managers ?? false,
          whatsapp_to_managers: rules.whatsapp_to_managers ?? false,
          email_to_managers: (rules as any).email_to_managers ?? false,
          lead_welcome_sms: rules.lead_welcome_sms || DEFAULTS.lead_welcome_sms,
          lead_welcome_whatsapp: rules.lead_welcome_whatsapp || DEFAULTS.lead_welcome_whatsapp,
          team_alert_sms: rules.team_alert_sms || DEFAULTS.team_alert_sms,
          team_alert_whatsapp: rules.team_alert_whatsapp || DEFAULTS.team_alert_whatsapp,
        });
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
      queryClient.invalidateQueries({ queryKey: ['lead-notification-rules'] });
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useImperativeHandle(ref, () => ({ save }), [form, rules, branchId]);

    const toggle = (field: keyof LeadRulesForm) => {
      setForm((prev) => ({ ...prev, [field]: !prev[field] }));
    };

    if (isLoading) {
      const count = variant === 'both' ? 2 : 1;
      return (
        <>
          {Array.from({ length: count }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent className="space-y-4">
                {[1, 2, 3].map((j) => (
                  <Skeleton key={j} className="h-10 w-full" />
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      );
    }

    const showLead = variant === 'both' || variant === 'lead';
    const showTeam = variant === 'both' || variant === 'team';

    return (
      <>
        {showLead && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-primary" />
                <CardTitle>Lead Alerts</CardTitle>
              </div>
              <CardDescription>Notify the lead when they're captured</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Row
                label="SMS to Lead"
                desc="Send welcome SMS to captured lead"
                checked={form.sms_to_lead}
                onChange={() => toggle('sms_to_lead')}
              />
              <Row
                label="WhatsApp to Lead"
                desc="Send WhatsApp welcome message to lead"
                checked={form.whatsapp_to_lead}
                onChange={() => toggle('whatsapp_to_lead')}
              />
              <Row
                label="Email to Lead"
                desc="Send a branded welcome email to the lead"
                checked={form.email_to_lead}
                onChange={() => toggle('email_to_lead')}
              />
            </CardContent>
          </Card>
        )}

        {showTeam && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <CardTitle>Team Alerts</CardTitle>
              </div>
              <CardDescription>Alert your team when new leads arrive</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Row
                label="SMS to Admins"
                desc="Alert owners & admins via SMS"
                checked={form.sms_to_admins}
                onChange={() => toggle('sms_to_admins')}
              />
              <Row
                label="WhatsApp to Admins"
                desc="Alert owners & admins via WhatsApp"
                checked={form.whatsapp_to_admins}
                onChange={() => toggle('whatsapp_to_admins')}
              />
              <Row
                label="SMS to Managers"
                desc="Alert branch managers via SMS"
                checked={form.sms_to_managers}
                onChange={() => toggle('sms_to_managers')}
              />
              <Row
                label="WhatsApp to Managers"
                desc="Alert branch managers via WhatsApp"
                checked={form.whatsapp_to_managers}
                onChange={() => toggle('whatsapp_to_managers')}
              />
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <strong>Heads up:</strong> Meta WhatsApp Cloud API only delivers free-form text alerts to admins
                who have messaged the business number in the last 24&nbsp;hours. Admins who have never replied to
                the business WhatsApp will see <em>"sent"</em> in the Live Feed but won't actually receive the
                message until an approved template is used. Ask each admin to send a quick "Hi" once, or set up
                an approved <code>lead_alert_team</code> template in Meta Business Manager.
              </p>
            </CardContent>
          </Card>
        )}
      </>
    );
  }
);

function Row({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <Label>{label}</Label>
        <p className="text-sm text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

// === Per-admin recipient toggles — full-width card ===
interface AdminRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
}

function maskPhone(p: string | null): string {
  if (!p) return '—';
  const digits = p.replace(/\D/g, '');
  if (digits.length < 4) return p;
  return `${p.slice(0, p.length - digits.length + 2)}•••${digits.slice(-2)}`;
}

export function AdminRecipientsCard() {
  const queryClient = useQueryClient();
  const { data: admins, isLoading } = useQuery({
    queryKey: ['lead-notification-admin-recipients'],
    queryFn: async (): Promise<AdminRow[]> => {
      const { data: roleRows, error: rErr } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['owner', 'admin']);
      if (rErr) throw rErr;
      const ids = Array.from(new Set((roleRows || []).map((r: any) => r.user_id)));
      if (ids.length === 0) return [];

      const [{ data: profiles }, { data: prefs }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, phone').in('id', ids),
        supabase
          .from('lead_notification_admin_prefs')
          .select('user_id, whatsapp_enabled, sms_enabled')
          .in('user_id', ids),
      ]);

      const prefMap = new Map<string, { whatsapp_enabled: boolean; sms_enabled: boolean }>();
      for (const p of prefs || []) prefMap.set((p as any).user_id, p as any);

      return (profiles || []).map((p: any) => {
        const pref = prefMap.get(p.id) ?? { whatsapp_enabled: true, sms_enabled: true };
        return {
          id: p.id,
          full_name: p.full_name,
          phone: p.phone,
          whatsapp_enabled: pref.whatsapp_enabled,
          sms_enabled: pref.sms_enabled,
        };
      });
    },
  });

  const updatePref = useMutation({
    mutationFn: async (input: { user_id: string; whatsapp_enabled: boolean; sms_enabled: boolean }) => {
      const { error } = await supabase
        .from('lead_notification_admin_prefs')
        .upsert(input, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead-notification-admin-recipients'] }),
    onError: (e: any) => toast.error(e.message || 'Failed to update preference'),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle>Admin Recipients</CardTitle>
        </div>
        <CardDescription>
          Choose which owners/admins receive lead alerts. Master toggles above must also be on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : !admins || admins.length === 0 ? (
          <p className="text-sm text-muted-foreground">No owners/admins found.</p>
        ) : (
          <div className="divide-y">
            {admins.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Label className="block">{a.full_name || 'Unnamed'}</Label>
                  <p className="text-sm text-muted-foreground">{maskPhone(a.phone)}</p>
                </div>
                <div className="flex items-center gap-5">
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">WhatsApp</span>
                    <Switch
                      checked={a.whatsapp_enabled}
                      onCheckedChange={(v) =>
                        updatePref.mutate({ user_id: a.id, whatsapp_enabled: v, sms_enabled: a.sms_enabled })
                      }
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">SMS</span>
                    <Switch
                      checked={a.sms_enabled}
                      onCheckedChange={(v) =>
                        updatePref.mutate({ user_id: a.id, whatsapp_enabled: a.whatsapp_enabled, sms_enabled: v })
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Backwards-compat: any other importer of LeadNotificationSettings still works.
export function LeadNotificationSettings() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <LeadNotificationCards />
    </div>
  );
}
