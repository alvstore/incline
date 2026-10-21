import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, KeyRound, Monitor } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { RegistrationGeofenceCard } from '@/components/settings/RegistrationGeofenceCard';

export function SecuritySettings() {
  const { user, session } = useAuth();
  const queryClient = useQueryClient();
  const [sessionTimeout, setSessionTimeout] = useState(8);
  const [sessionTimeoutEnabled, setSessionTimeoutEnabled] = useState(true);

  // Fetch org settings
  const { data: orgSettings, isLoading } = useQuery({
    queryKey: ['org-settings-security'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('id, session_timeout_hours')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (orgSettings?.session_timeout_hours != null) {
      setSessionTimeout(orgSettings.session_timeout_hours);
      setSessionTimeoutEnabled(orgSettings.session_timeout_hours > 0);
    }
  }, [orgSettings]);

  const saveTimeout = useMutation({
    mutationFn: async () => {
      if (!orgSettings?.id) throw new Error('No organization settings found');
      const hours = sessionTimeoutEnabled ? sessionTimeout : 0;
      const { error } = await supabase
        .from('organization_settings')
        .update({ session_timeout_hours: hours })
        .eq('id', orgSettings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-settings-security'] });
      toast.success('Session timeout settings saved');
    },
    onError: () => toast.error('Failed to save settings'),
  });




  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Security Settings</h2>
        <p className="text-sm text-muted-foreground">Configure security and session management. Backups live under the Backup &amp; Restore tab.</p>
      </div>

      <RegistrationGeofenceCard />


      {/* Password Policy */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle>Password Policy</CardTitle>
          </div>
          <CardDescription>Current password requirements enforced during signup and password changes</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">Minimum length</span>
              <Badge>8 characters</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">Uppercase required</span>
              <Badge variant="secondary">Recommended</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">Special character required</span>
              <Badge variant="secondary">Recommended</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm">Number required</span>
              <Badge variant="secondary">Recommended</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Session Timeout */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            <CardTitle>Session Management</CardTitle>
          </div>
          <CardDescription>Configure auto-logout and session duration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto Logout on Inactivity</Label>
              <p className="text-sm text-muted-foreground">Automatically sign out users after idle period</p>
            </div>
            <Switch
              checked={sessionTimeoutEnabled}
              onCheckedChange={setSessionTimeoutEnabled}
            />
          </div>
          {sessionTimeoutEnabled && (
            <div className="space-y-2">
              <Label htmlFor="session-duration">Session Duration (hours)</Label>
              <Input
                id="session-duration"
                type="number"
                value={sessionTimeout}
                onChange={(e) => setSessionTimeout(parseInt(e.target.value) || 1)}
                min={1}
                max={72}
                className="max-w-xs"
              />
            </div>
          )}
          <Button
            onClick={() => saveTimeout.mutate()}
            disabled={saveTimeout.isPending || isLoading}
            size="sm"
          >
            {saveTimeout.isPending ? 'Saving...' : 'Save Session Settings'}
          </Button>

          {/* Current Session Info */}
          {session && (
            <div className="mt-4 p-4 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <Monitor className="h-4 w-4 text-primary" />
                <Label className="font-semibold">Current Session</Label>
              </div>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email</span>
                  <span className="font-mono text-xs">{user?.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Signed in at</span>
                  <span>{session.user?.last_sign_in_at ? new Date(session.user.last_sign_in_at).toLocaleString() : 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Session expires</span>
                  <span>{session.expires_at ? new Date(session.expires_at * 1000).toLocaleString() : 'Unknown'}</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
