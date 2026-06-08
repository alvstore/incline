import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import { Megaphone, Send, Save, Zap, Clock, Gift, Mail, MessageSquare, Phone, BarChart3, ShieldCheck, Sparkles } from 'lucide-react';
import { dispatchCommunication } from '@/lib/comms/dispatch';
import { useBranchContext } from '@/contexts/BranchContext';
import { useAuth } from '@/contexts/AuthContext';
import { AIGenerateTemplatesDrawer } from '@/components/settings/AIGenerateTemplatesDrawer';

const STAGE_ICONS = [Zap, Clock, Gift];
const STAGE_COLORS = [
  'bg-info/10 text-info border-info/25',
  'bg-warning/10 text-warning border-warning/25',
  'bg-success/10 text-success border-success/25',
];

const CHANNEL_OPTIONS = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare, color: 'text-success' },
  { id: 'sms', label: 'SMS', icon: Phone, color: 'text-info' },
  { id: 'email', label: 'Email', icon: Mail, color: 'text-primary' },
];

export function RetentionCampaignManager() {
  const queryClient = useQueryClient();
  const { selectedBranch, currentBranchId } = useBranchContext() as any;
  const { profile } = useAuth();
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false);
  const [testPhone, setTestPhone] = useState<string>(profile?.phone || '');
  const [testEmail, setTestEmail] = useState<string>(profile?.email || '');
  const [testingKey, setTestingKey] = useState<string | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['retention-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('retention_templates')
        .select('*')
        .order('stage_level', { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: deliveryStats = {} } = useQuery({
    queryKey: ['retention-delivery-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('retention_nudge_logs')
        .select('stage_level, status');
      if (error) throw error;
      const stats: Record<number, { sent: number; total: number }> = {};
      for (const log of data || []) {
        if (!stats[log.stage_level]) stats[log.stage_level] = { sent: 0, total: 0 };
        stats[log.stage_level].total++;
        if (log.status === 'sent') stats[log.stage_level].sent++;
      }
      return stats;
    },
  });

  const [edits, setEdits] = useState<Record<string, { days_trigger?: number; message_body?: string; is_active?: boolean; channels?: string[] }>>({});
  const [previewName, setPreviewName] = useState('John');

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase
        .from('retention_templates')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['retention-templates'] });
      toast({ title: 'Template updated', description: 'Retention stage saved successfully.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const getEditValue = (id: string, field: string, original: any) => {
    return edits[id]?.[field as keyof typeof edits[string]] ?? original;
  };

  const setEdit = (id: string, field: string, value: any) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleChannelToggle = (templateId: string, channel: string, currentChannels: string[]) => {
    const channels = currentChannels.includes(channel)
      ? currentChannels.filter(c => c !== channel)
      : [...currentChannels, channel];
    if (channels.length === 0) return;
    setEdit(templateId, 'channels', channels);
  };

  const handleSave = (template: any) => {
    const changes = edits[template.id];
    if (!changes) return;
    updateMutation.mutate({ id: template.id, updates: changes });
    setEdits(prev => {
      const next = { ...prev };
      delete next[template.id];
      return next;
    });
  };

  const handleTestSend = async (template: any, channel: string) => {
    const branchId = currentBranchId || (selectedBranch && selectedBranch !== 'all' ? selectedBranch : null);
    if (!branchId) {
      toast({ title: 'Pick a branch', description: 'Select a specific branch (not "All Branches") to send a test.', variant: 'destructive' });
      return;
    }
    const recipient = channel === 'email' ? testEmail.trim() : testPhone.trim();
    if (!recipient) {
      toast({
        title: `Missing test ${channel === 'email' ? 'email' : 'phone'}`,
        description: `Enter a ${channel === 'email' ? 'email address' : 'phone number'} above to send the test.`,
        variant: 'destructive',
      });
      return;
    }
    const body = (getEditValue(template.id, 'message_body', template.message_body) as string)
      .replace(/{member_name}/g, profile?.full_name?.split(' ')[0] || 'there');
    const eventKey = `retention_stage_${template.stage_level}`;
    const key = `${template.id}:${channel}`;
    setTestingKey(key);
    try {
      const result = await dispatchCommunication({
        branch_id: branchId,
        channel: channel as any,
        category: 'retention_nudge',
        recipient,
        payload: {
          subject: `Stage ${template.stage_level}: ${template.stage_name}`,
          body,
          variables: { member_name: profile?.full_name || 'there', event_key: eventKey },
          use_branded_template: channel === 'email',
        },
        dedupe_key: `retention-test:${template.stage_level}:${channel}:${Date.now()}`,
        force: true,
      });
      if (result.status === 'sent' || result.status === 'queued') {
        toast({ title: `Test ${channel} ${result.status}`, description: `Sent to ${recipient}` });
      } else {
        toast({
          title: `Test ${channel} ${result.status}`,
          description: result.reason || 'Dispatcher did not deliver. Check Templates Hub coverage.',
          variant: 'destructive',
        });
      }
    } catch (err: any) {
      toast({
        title: `Test ${channel} failed`,
        description: err?.message || 'Dispatcher error. Confirm a template is approved for this event.',
        variant: 'destructive',
      });
    } finally {
      setTestingKey(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary p-2.5 rounded-full">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Retention Campaign</h2>
            <p className="text-sm text-muted-foreground">
              Configure the 3-stage automated nudge sequence for inactive members.
              Use <code className="bg-muted px-1 rounded text-xs">{'{member_name}'}</code> as a placeholder.
            </p>
            <p className="text-xs text-info mt-1">
              Members with a frozen membership are automatically excluded until the freeze is lifted.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAiDrawerOpen(true)}>
          <Sparkles className="h-3.5 w-3.5 mr-1.5 text-primary" />
          Generate WhatsApp Templates with AI
        </Button>
      </div>

      {/* Cooldown Indicator */}
      <Card className="rounded-2xl border-info/25 bg-info/10">
        <CardContent className="flex items-center gap-3 py-4">
          <ShieldCheck className="h-5 w-5 text-info shrink-0" />
          <div>
            <p className="text-sm font-medium text-info">30-Day Cooldown Active</p>
            <p className="text-xs text-info">Each member can only receive each nudge stage once every 30 days. Sequence resets if the member visits the gym.</p>
          </div>
        </CardContent>
      </Card>

      {/* Test recipient — used by all "Test" buttons below */}
      <Card className="rounded-2xl">
        <CardContent className="py-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Test phone (WhatsApp / SMS)</Label>
            <Input
              className="mt-1.5"
              placeholder="+91XXXXXXXXXX"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Test email</Label>
            <Input
              className="mt-1.5"
              type="email"
              placeholder="you@example.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {templates.map((template: any, idx: number) => {
          const Icon = STAGE_ICONS[idx] || Zap;
          const colorClass = STAGE_COLORS[idx] || STAGE_COLORS[0];
          const hasChanges = !!edits[template.id];
          const isActive = getEditValue(template.id, 'is_active', template.is_active) as boolean;
          const channels = getEditValue(template.id, 'channels', template.channels || ['whatsapp']) as string[];
          const stageStats = (deliveryStats as any)[template.stage_level];
          const messageBody = getEditValue(template.id, 'message_body', template.message_body) as string;

          return (
            <Card key={template.id} className={`rounded-2xl shadow-lg transition-all ${!isActive ? 'opacity-60' : ''}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-full border ${colorClass}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Stage {template.stage_level}: {template.stage_name}</CardTitle>
                    <p className="text-xs text-muted-foreground">Triggered after member is absent</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {stageStats && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <BarChart3 className="h-3.5 w-3.5" />
                      <span>{stageStats.sent} sent</span>
                    </div>
                  )}
                  <Badge variant={isActive ? 'default' : 'secondary'}>
                    {isActive ? 'Active' : 'Paused'}
                  </Badge>
                  <Switch
                    checked={isActive}
                    onCheckedChange={(v) => setEdit(template.id, 'is_active', v)}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Label className="whitespace-nowrap text-sm font-medium">Days absent:</Label>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    className="w-24"
                    value={getEditValue(template.id, 'days_trigger', template.days_trigger)}
                    onChange={(e) => setEdit(template.id, 'days_trigger', parseInt(e.target.value) || template.days_trigger)}
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>

                {/* Multi-Channel Selector */}
                <div>
                  <Label className="text-sm font-medium mb-2 block">Delivery Channels</Label>
                  <div className="flex flex-wrap gap-3">
                    {CHANNEL_OPTIONS.map(ch => {
                      const ChIcon = ch.icon;
                      const isSelected = channels.includes(ch.id);
                      return (
                        <label
                          key={ch.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer transition-colors ${
                            isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => handleChannelToggle(template.id, ch.id, channels)}
                          />
                          <ChIcon className={`h-4 w-4 ${ch.color}`} />
                          <span className="text-sm font-medium">{ch.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">Message Template</Label>
                  <Textarea
                    className="mt-1.5 min-h-[80px]"
                    value={messageBody}
                    onChange={(e) => setEdit(template.id, 'message_body', e.target.value)}
                  />
                </div>

                {/* Preview Panel */}
                <div className="bg-muted/50 rounded-xl p-3 border">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium text-muted-foreground">Preview</Label>
                    <Input
                      className="w-32 h-7 text-xs"
                      placeholder="Preview name"
                      value={previewName}
                      onChange={(e) => setPreviewName(e.target.value)}
                    />
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">
                    {messageBody.replace(/{member_name}/g, previewName || 'Member')}
                  </p>
                </div>

                <Separator />

                <div className="flex gap-2 justify-end flex-wrap">
                  {channels.map(ch => {
                    const chOption = CHANNEL_OPTIONS.find(o => o.id === ch);
                    const ChIcon = chOption?.icon || Send;
                    const tk = `${template.id}:${ch}`;
                    return (
                      <Button
                        key={ch}
                        variant="outline"
                        size="sm"
                        disabled={testingKey === tk}
                        onClick={() => handleTestSend(template, ch)}
                      >
                        <ChIcon className={`h-3.5 w-3.5 mr-1.5 ${chOption?.color || ''}`} />
                        {testingKey === tk ? 'Sending…' : `Test ${chOption?.label || ch}`}
                      </Button>
                    );
                  })}
                  <Button
                    size="sm"
                    disabled={!hasChanges || updateMutation.isPending}
                    onClick={() => handleSave(template)}
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save Changes
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {templates.length === 0 && (
        <Card className="rounded-2xl">
          <CardContent className="py-12 text-center text-muted-foreground">
            <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>No retention templates configured yet.</p>
          </CardContent>
        </Card>
      )}

      <AIGenerateTemplatesDrawer
        open={aiDrawerOpen}
        onOpenChange={setAiDrawerOpen}
        channel="whatsapp"
        prefilledEvents={['retention_stage_1', 'retention_stage_2', 'retention_stage_3']}
      />
    </div>
  );
}
