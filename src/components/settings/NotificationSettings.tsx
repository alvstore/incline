import { useState, useEffect, useRef } from 'react';
import {
  LeadNotificationCards,
  AdminRecipientsCard,
  type LeadNotificationCardsHandle,
} from '@/components/settings/LeadNotificationSettings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Mail, Bell, Save } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchPreferences, upsertPreferences } from '@/services/notificationService';
import { toast } from 'sonner';

export function NotificationSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  const [preferences, setPreferences] = useState({
    email_membership_reminders: true,
    email_payment_receipts: true,
    email_class_notifications: true,
    email_announcements: true,
    push_low_stock: true,
    push_new_leads: true,
    push_payment_alerts: true,
    push_task_reminders: true,
  });

  const { data: savedPreferences, isLoading } = useQuery({
    queryKey: ['notification-preferences', user?.id],
    queryFn: () => fetchPreferences(user!.id),
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (savedPreferences) {
      setPreferences({
        email_membership_reminders: savedPreferences.email_membership_reminders,
        email_payment_receipts: savedPreferences.email_payment_receipts,
        email_class_notifications: savedPreferences.email_class_notifications,
        email_announcements: savedPreferences.email_announcements,
        push_low_stock: savedPreferences.push_low_stock,
        push_new_leads: savedPreferences.push_new_leads,
        push_payment_alerts: savedPreferences.push_payment_alerts,
        push_task_reminders: savedPreferences.push_task_reminders,
      });
    }
  }, [savedPreferences]);

  const saveMutation = useMutation({
    mutationFn: () => upsertPreferences(user!.id, preferences),
    onSuccess: () => {
      toast.success('Notification preferences saved');
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
    onError: () => {
      toast.error('Failed to save preferences');
    },
  });

  const updatePreference = (key: string, value: boolean) => {
    setPreferences(prev => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Notification Settings</h2>
        <p className="text-sm text-muted-foreground">Configure email and system notifications</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <CardTitle>Email Notifications</CardTitle>
            </div>
            <CardDescription>Configure email notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Membership Reminders</Label>
                <p className="text-sm text-muted-foreground">Send expiry reminders to members</p>
              </div>
              <Switch 
                checked={preferences.email_membership_reminders}
                onCheckedChange={(v) => updatePreference('email_membership_reminders', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Payment Receipts</Label>
                <p className="text-sm text-muted-foreground">Send receipts after payments</p>
              </div>
              <Switch 
                checked={preferences.email_payment_receipts}
                onCheckedChange={(v) => updatePreference('email_payment_receipts', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Class Notifications</Label>
                <p className="text-sm text-muted-foreground">Send class booking confirmations</p>
              </div>
              <Switch 
                checked={preferences.email_class_notifications}
                onCheckedChange={(v) => updatePreference('email_class_notifications', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Announcements</Label>
                <p className="text-sm text-muted-foreground">Receive gym announcements via email</p>
              </div>
              <Switch 
                checked={preferences.email_announcements}
                onCheckedChange={(v) => updatePreference('email_announcements', v)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary" />
              <CardTitle>System Alerts</CardTitle>
            </div>
            <CardDescription>Manage system notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Low Stock Alerts</Label>
                <p className="text-sm text-muted-foreground">Get notified when inventory is low</p>
              </div>
              <Switch 
                checked={preferences.push_low_stock}
                onCheckedChange={(v) => updatePreference('push_low_stock', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>New Lead Alerts</Label>
                <p className="text-sm text-muted-foreground">Get notified about new leads</p>
              </div>
              <Switch 
                checked={preferences.push_new_leads}
                onCheckedChange={(v) => updatePreference('push_new_leads', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Payment Alerts</Label>
                <p className="text-sm text-muted-foreground">Get notified about overdue payments</p>
              </div>
              <Switch 
                checked={preferences.push_payment_alerts}
                onCheckedChange={(v) => updatePreference('push_payment_alerts', v)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Task Reminders</Label>
                <p className="text-sm text-muted-foreground">Get reminders for assigned tasks</p>
              </div>
              <Switch 
                checked={preferences.push_task_reminders}
                onCheckedChange={(v) => updatePreference('push_task_reminders', v)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lead Notification Rules — styled to match Email + System Alerts */}
      <LeadNotificationSettings />

      <div className="flex justify-end">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? 'Saving...' : 'Save Preferences'}
        </Button>
      </div>
    </div>
  );
}

