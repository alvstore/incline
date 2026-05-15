import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Save, Loader2, Info, Eye, EyeOff } from 'lucide-react';

const DEFAULT_SYSTEM_PROMPT = '';

interface AiConfig {
  auto_reply_enabled: boolean;
  system_prompt: string;
  reply_delay_seconds: number;
}

export function WhatsAppAISettings() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<AiConfig>({
    auto_reply_enabled: false,
    system_prompt: DEFAULT_SYSTEM_PROMPT,
    reply_delay_seconds: 3,
  });

  const { data: orgSettings, isLoading } = useQuery({
    queryKey: ['org-settings-ai'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_settings')
        .select('id, whatsapp_ai_config')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: purposePrompt = '' } = useQuery({
    queryKey: ['ai_purpose_prompt', 'whatsapp_reply'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_purposes')
        .select('system_prompt')
        .eq('purpose', 'whatsapp_reply')
        .is('branch_id', null)
        .maybeSingle();
      return (data?.system_prompt as string) ?? '';
    },
  });

  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (orgSettings?.whatsapp_ai_config) {
      const saved = orgSettings.whatsapp_ai_config as any;
      setConfig({
        auto_reply_enabled: saved.auto_reply_enabled ?? false,
        system_prompt: saved.system_prompt || DEFAULT_SYSTEM_PROMPT,
        reply_delay_seconds: saved.reply_delay_seconds ?? 3,
      });
    }
  }, [orgSettings]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      if (!orgSettings?.id) throw new Error('Organization settings not found');
      const { error } = await supabase
        .from('organization_settings')
        .update({ whatsapp_ai_config: config as any })
        .eq('id', orgSettings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('AI auto-reply settings saved');
      queryClient.invalidateQueries({ queryKey: ['org-settings-ai'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to save'),
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="p-1.5 rounded-lg bg-violet-500/10">
            <Bot className="h-4 w-4 text-violet-600" />
          </div>
          AI Auto-Reply
        </CardTitle>
        <CardDescription>
          Automatically reply to incoming WhatsApp messages using AI. The bot uses your gym context to generate helpful responses.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <Label className="font-semibold">Enable AI Auto-Reply</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, the AI will automatically respond to incoming WhatsApp messages.
            </p>
          </div>
          <Switch
            checked={config.auto_reply_enabled}
            onCheckedChange={(v) => setConfig({ ...config, auto_reply_enabled: v })}
          />
        </div>

        <div className="space-y-2">
          <Label className="font-semibold">Reply Delay (seconds)</Label>
          <Input
            type="number"
            min={0}
            max={30}
            value={config.reply_delay_seconds}
            onChange={(e) => setConfig({ ...config, reply_delay_seconds: parseInt(e.target.value) || 0 })}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            Wait this many seconds before sending the AI reply (0-30). A short delay feels more natural.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="font-semibold">Extra Gym Context (overlay)</Label>
          <Textarea
            rows={6}
            value={config.system_prompt}
            onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
            placeholder="Add current offers, branch-specific notes, pricing tweaks, or talking points the AI should mention. Leave blank to use only the base purpose prompt."
            className="font-mono text-xs"
          />
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-indigo-50/60 border border-indigo-100">
            <Info className="h-3.5 w-3.5 text-indigo-600 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600">
              This text is <b>appended</b> to the base WhatsApp Replies prompt configured in
              <b> Settings → AI Agent → Purposes</b>. Edit the base prompt there to change the AI's core persona;
              use this box for short-lived context like seasonal offers.
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
              {[purposePrompt.trim(), config.system_prompt.trim()].filter(Boolean).join('\n\n') || '(empty — set a base prompt in Purposes tab)'}
            </pre>
          )}
        </div>

        <Button
          className="w-full"
          onClick={() => saveConfig.mutate()}
          disabled={saveConfig.isPending}
        >
          {saveConfig.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save AI Settings
        </Button>
      </CardContent>
    </Card>
  );
}
