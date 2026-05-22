import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Clock, Play, CheckCircle, RefreshCw, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// Cadence-only. Persona lives in Purposes → lead_nurture; shared knowledge in Brain tab.
export function LeadNurtureSettings() {
  const queryClient = useQueryClient();

  const { data: orgSettings, isLoading } = useQuery({
    queryKey: ['org-lead-nurture'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('id, lead_nurture_config')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: staleStats } = useQuery({
    queryKey: ['lead-nurture-stats'],
    queryFn: async () => {
      const { count: eligibleCount } = await supabase
        .from('whatsapp_chat_settings')
        .select('*', { count: 'exact', head: true })
        .eq('bot_active', true)
        .not('partial_lead_data', 'is', null);

      const { data: lastNurtured } = await supabase
        .from('whatsapp_chat_settings')
        .select('last_nurture_at')
        .not('last_nurture_at', 'is', null)
        .order('last_nurture_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      return {
        eligibleChats: eligibleCount || 0,
        lastRunAt: lastNurtured?.last_nurture_at || null,
      };
    },
    refetchInterval: 30000,
  });

  const config = (orgSettings?.lead_nurture_config as any) ?? {
    enabled: true,
    delay_hours: 4,
    max_retries: 2,
  };
  const [enabled, setEnabled] = useState(config.enabled ?? true);
  const [delayHours, setDelayHours] = useState(String(config.delay_hours ?? 4));
  const [maxRetries, setMaxRetries] = useState(String(config.max_retries ?? 2));

  useEffect(() => {
    if (orgSettings?.lead_nurture_config) {
      const c = orgSettings.lead_nurture_config as any;
      setEnabled(c.enabled ?? true);
      setDelayHours(String(c.delay_hours ?? 4));
      setMaxRetries(String(c.max_retries ?? 2));
    }
  }, [orgSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existing = (orgSettings?.lead_nurture_config as any) || {};
      const payload = {
        ...existing,
        enabled,
        delay_hours: parseInt(delayHours) || 4,
        max_retries: parseInt(maxRetries) || 2,
      };
      // Strip the deprecated persona key.
      delete payload.nurture_prompt;
      if (orgSettings?.id) {
        const { error } = await supabase
          .from('organization_settings')
          .update({ lead_nurture_config: payload })
          .eq('id', orgSettings.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success('Lead nurture settings saved');
      queryClient.invalidateQueries({ queryKey: ['org-lead-nurture'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const runNowMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('lead-nurture-followup', {
        body: { triggered_by: 'manual' },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast.success(
        `Nurture run complete: ${data?.nudged || 0} nudged, ${data?.retries_reset || 0} counters reset`,
      );
      queryClient.invalidateQueries({ queryKey: ['lead-nurture-stats'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to run nurture'),
  });

  const resetCountersMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('whatsapp_chat_settings')
        .update({ nurture_retry_count: 0 })
        .gt('nurture_retry_count', 0);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('All retry counters reset — leads are eligible for nurture again');
      queryClient.invalidateQueries({ queryKey: ['lead-nurture-stats'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to reset counters'),
  });

  if (isLoading) return <Skeleton className="h-40 rounded-2xl" />;

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{staleStats?.eligibleChats ?? '-'}</p>
                <p className="text-xs text-muted-foreground">Eligible Chats</p>
              </div>
              <Separator orientation="vertical" className="h-10" />
              <div>
                <p className="text-sm font-medium">Last Nurture Run</p>
                <p className="text-xs text-muted-foreground">
                  {staleStats?.lastRunAt
                    ? formatDistanceToNow(new Date(staleStats.lastRunAt), { addSuffix: true })
                    : 'Never'}
                </p>
              </div>
              <Badge variant="outline" className="text-xs gap-1">
                <CheckCircle className="h-3 w-3" />
                Scheduled hourly via cron
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => runNowMutation.mutate()}
                disabled={runNowMutation.isPending}
                className="gap-1.5"
              >
                <Play className="h-3.5 w-3.5" />
                {runNowMutation.isPending ? 'Running...' : 'Run Now'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => resetCountersMutation.mutate()}
                disabled={resetCountersMutation.isPending}
                className="gap-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${resetCountersMutation.isPending ? 'animate-spin' : ''}`}
                />
                Reset Counters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-amber-50">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            Lead Nurture Cadence
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Controls <b>when and how often</b> the AI follows up with stale leads. The message itself is
            generated using the <b>lead_nurture</b> persona (Purposes tab) and the shared knowledge in
            the <b>Brain</b> tab.
          </p>
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <Label>{enabled ? 'Enabled' : 'Disabled'}</Label>
          </div>
          <Separator />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Follow-up Delay (hours)</Label>
              <Input
                type="number"
                min="1"
                max="24"
                value={delayHours}
                onChange={(e) => setDelayHours(e.target.value)}
                placeholder="4"
              />
              <p className="text-xs text-muted-foreground">
                How long to wait before sending a follow-up.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Max Retries</Label>
              <Input
                type="number"
                min="1"
                max="5"
                value={maxRetries}
                onChange={(e) => setMaxRetries(e.target.value)}
                placeholder="2"
              />
              <p className="text-xs text-muted-foreground">
                Maximum follow-up attempts within 24 hours.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-3 rounded-lg bg-indigo-50/60 border border-indigo-100">
            <Info className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600">
              The old <i>Extra Nurture Context</i> textarea was removed. Any text you had there has been
              merged into the <b>lead_nurture</b> purpose prompt and is now shared with the brain
              architecture.
            </p>
          </div>

          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Nurture Settings'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
