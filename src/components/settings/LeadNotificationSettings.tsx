import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useBranchContext } from '@/contexts/BranchContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Save, UserCheck, Users, ExternalLink, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function LeadNotificationSettings() {
  const { selectedBranch } = useBranchContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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

  const [form, setForm] = useState({
    sms_to_lead: false,
    whatsapp_to_lead: false,
    sms_to_admins: false,
    whatsapp_to_admins: false,
    sms_to_managers: false,
    whatsapp_to_managers: false,
    lead_welcome_sms: 'Hi {{lead_name}}, thank you for your interest in {{branch_name}}! We will contact you shortly.',
    lead_welcome_whatsapp: 'Hi {{lead_name}}, welcome to {{branch_name}}! 🏋️ Our team will reach out to you soon.',
    team_alert_sms: 'New lead: {{lead_name}} ({{lead_phone}}) from {{lead_source}} at {{branch_name}}',
    team_alert_whatsapp: '🔔 New Lead Alert\nName: {{lead_name}}\nPhone: {{lead_phone}}\nSource: {{lead_source}}\nBranch: {{branch_name}}',
  });

  useEffect(() => {
    if (rules) {
      setForm({
        sms_to_lead: rules.sms_to_lead ?? false,
        whatsapp_to_lead: rules.whatsapp_to_lead ?? false,
        sms_to_admins: rules.sms_to_admins ?? false,
        whatsapp_to_admins: rules.whatsapp_to_admins ?? false,
        sms_to_managers: rules.sms_to_managers ?? false,
        whatsapp_to_managers: rules.whatsapp_to_managers ?? false,
        lead_welcome_sms: rules.lead_welcome_sms || form.lead_welcome_sms,
        lead_welcome_whatsapp: rules.lead_welcome_whatsapp || form.lead_welcome_whatsapp,
        team_alert_sms: rules.team_alert_sms || form.team_alert_sms,
        team_alert_whatsapp: rules.team_alert_whatsapp || form.team_alert_whatsapp,
      });
    }
  }, [rules]);

  const saveMutation = useMutation({
    mutationFn: async () => {
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
    },
    onSuccess: () => {
      toast.success('Lead notification settings saved');
      queryClient.invalidateQueries({ queryKey: ['lead-notification-rules'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to save'),
  });

  if (isLoading) {
    return (
      <Card className="rounded-xl">
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  const toggleField = (field: keyof typeof form) => {
    setForm(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const enabledCount = [
    form.sms_to_lead, form.whatsapp_to_lead,
    form.sms_to_admins, form.whatsapp_to_admins,
    form.sms_to_managers, form.whatsapp_to_managers,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <Card className="rounded-xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            <CardTitle>Lead Notification Rules</CardTitle>
            {enabledCount > 0 && (
              <Badge variant="default" className="ml-2">{enabledCount} active</Badge>
            )}
          </div>
          <CardDescription>
            Configure automated SMS and WhatsApp notifications when a new lead is captured.
            {branchId ? ' Settings apply to the selected branch.' : ' These are global defaults.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Lead Capture Alerts */}
          <div className="space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" />
              Lead Capture Alerts
            </h4>
            <p className="text-xs text-muted-foreground -mt-2">Notify the lead when they're captured</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>SMS to Lead</Label>
                  <p className="text-sm text-muted-foreground">Send welcome SMS to captured lead</p>
                </div>
                <Switch checked={form.sms_to_lead} onCheckedChange={() => toggleField('sms_to_lead')} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>WhatsApp to Lead</Label>
                  <p className="text-sm text-muted-foreground">Send WhatsApp welcome message to lead</p>
                </div>
                <Switch checked={form.whatsapp_to_lead} onCheckedChange={() => toggleField('whatsapp_to_lead')} />
              </div>
            </div>
          </div>

          {/* Follow-up Reminders (Admin & Manager alerts) */}
          <div className="space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Follow-up Reminders
            </h4>
            <p className="text-xs text-muted-foreground -mt-2">Alert your team when new leads arrive</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>SMS to Admins</Label>
                  <p className="text-sm text-muted-foreground">Alert owners & admins via SMS</p>
                </div>
                <Switch checked={form.sms_to_admins} onCheckedChange={() => toggleField('sms_to_admins')} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>WhatsApp to Admins</Label>
                  <p className="text-sm text-muted-foreground">Alert owners & admins via WhatsApp</p>
                </div>
                <Switch checked={form.whatsapp_to_admins} onCheckedChange={() => toggleField('whatsapp_to_admins')} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>SMS to Managers</Label>
                  <p className="text-sm text-muted-foreground">Alert branch managers via SMS</p>
                </div>
                <Switch checked={form.sms_to_managers} onCheckedChange={() => toggleField('sms_to_managers')} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>WhatsApp to Managers</Label>
                  <p className="text-sm text-muted-foreground">Alert branch managers via WhatsApp</p>
                </div>
                <Switch checked={form.whatsapp_to_managers} onCheckedChange={() => toggleField('whatsapp_to_managers')} />
              </div>
            </div>
          </div>

          {/* Per-admin recipient toggles */}
          <AdminRecipientsPanel />

          {/* Conversion Notifications (Placeholder) */}
          <div className="space-y-2">
            <h4 className="font-semibold text-sm flex items-center gap-2 text-muted-foreground">
              🎯 Conversion Notifications
            </h4>
            <p className="text-xs text-muted-foreground">
              Coming soon — get notified when leads convert to members.
            </p>
          </div>

          {/* Template link */}
          <div className="p-3 rounded-lg bg-muted/50 border flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              Message templates are managed in{' '}
              <button
                onClick={() => navigate('/settings?tab=templates')}
                className="text-primary font-medium hover:underline"
              >
                Settings → Templates
              </button>
            </p>
          </div>
        </CardContent>
      </Card>

      <Button
        className="w-full"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        <Save className="h-4 w-4 mr-2" />
        {saveMutation.isPending ? 'Saving...' : 'Save Notification Settings'}
      </Button>
    </div>
  );
}
