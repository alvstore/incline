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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Clock, Brain, Play, CheckCircle, RefreshCw, Info, Eye, EyeOff } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

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

  // Fetch stale chat stats for observability
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

  const config = orgSettings?.lead_nurture_config as any ?? { enabled: true, delay_hours: 4, max_retries: 2, nurture_prompt: '' };
  const [enabled, setEnabled] = useState(config.enabled ?? true);
  const [delayHours, setDelayHours] = useState(String(config.delay_hours ?? 4));
  const [maxRetries, setMaxRetries] = useState(String(config.max_retries ?? 2));
  const [nurturePrompt, setNurturePrompt] = useState(config.nurture_prompt ?? '');
  const [showPreview, setShowPreview] = useState(false);

  const { data: purposePrompt = '' } = useQuery({
    queryKey: ['ai_purpose_prompt', 'lead_nurture'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_purposes')
        .select('system_prompt')
        .eq('purpose', 'lead_nurture')
        .is('branch_id', null)
        .maybeSingle();
      return (data?.system_prompt as string) ?? '';
    },
  });

  useEffect(() => {
    if (orgSettings?.lead_nurture_config) {
      const c = orgSettings.lead_nurture_config as any;
      setEnabled(c.enabled ?? true);
      setDelayHours(String(c.delay_hours ?? 4));
      setMaxRetries(String(c.max_retries ?? 2));
      setNurturePrompt(c.nurture_prompt ?? '');
    }
  }, [orgSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        enabled,
        delay_hours: parseInt(delayHours) || 4,
        max_retries: parseInt(maxRetries) || 2,
        nurture_prompt: nurturePrompt,
      };
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
      toast.success(`Nurture run complete: ${data?.nudged || 0} nudged, ${data?.retries_reset || 0} counters reset`);
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
      {/* Observability Stats */}
      <Card className="rounded-2xl shadow-lg shadow-primary/5">
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
                <RefreshCw className={`h-3.5 w-3.5 ${resetCountersMutation.isPending ? 'animate-spin' : ''}`} />
                Reset Counters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-lg shadow-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-amber-50">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            AI Lead Nurture Follow-up
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Automatically send a contextual follow-up to leads who haven't replied within the configured time window. The AI generates personalized nudges based on collected data and missing fields.
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
                onChange={e => setDelayHours(e.target.value)}
                placeholder="4"
              />
              <p className="text-xs text-muted-foreground">How long to wait before sending a follow-up</p>
            </div>
            <div className="space-y-2">
              <Label>Max Retries</Label>
              <Input
                type="number"
                min="1"
                max="5"
                value={maxRetries}
                onChange={e => setMaxRetries(e.target.value)}
                placeholder="2"
              />
              <p className="text-xs text-muted-foreground">Maximum number of follow-up attempts within 24 hours</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-lg shadow-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-violet-50">
              <Brain className="h-5 w-5 text-violet-600" />
            </div>
            Extra Nurture Context (overlay)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This text is <b>appended</b> to the base Lead Nurture prompt configured in
            {' '}<b>Settings → AI Agent → Purposes</b> (lead_nurture). Use it for current offers, gym USPs, or
            specific talking points. Provider/model is set in the <b>Providers</b> tab.
          </p>
          <div className="space-y-2">
            <Label>Overlay Prompt</Label>
            <Textarea
              value={nurturePrompt}
              onChange={e => setNurturePrompt(e.target.value)}
              placeholder="e.g., We're running a 20% off New Year offer. Mention our premium sauna and ice bath facilities. Our trainers are nationally certified..."
              rows={4}
            />
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-indigo-50/60 border border-indigo-100">
              <Info className="h-3.5 w-3.5 text-indigo-600 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-600">
                Leave empty to use only the base purpose prompt. Edit the base persona in the Purposes tab.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-xs gap-1.5 px-0 h-7"
              onClick={() => setShowPreview(v => !v)}
            >
              {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showPreview ? 'Hide' : 'Show'} merged final prompt
            </Button>
            {showPreview && (
              <pre className="text-[11px] font-mono whitespace-pre-wrap bg-slate-50 border rounded-md p-3 max-h-64 overflow-y-auto text-slate-700">
                {[purposePrompt.trim(), nurturePrompt.trim()].filter(Boolean).join('\n\n') || '(empty — set a base prompt in Purposes tab)'}
              </pre>
            )}
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving...' : 'Save Nurture Settings'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}