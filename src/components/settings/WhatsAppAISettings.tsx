import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Save, Loader2, Info } from 'lucide-react';

interface AiOperationalConfig {
  auto_reply_enabled: boolean;
  reply_delay_seconds: number;
}

// Persona text + overlay context now live in:
//   - Settings → AI Agent → Purposes  (system_prompt for `whatsapp_reply`)
//   - Settings → AI Agent → Brain     (shared knowledge applied to all handles)
// This tab is operational-only: on/off + delay.
export function WhatsAppAISettings() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<AiOperationalConfig>({
    auto_reply_enabled: false,
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

  useEffect(() => {
    if (orgSettings?.whatsapp_ai_config) {
      const saved = orgSettings.whatsapp_ai_config as any;
      setConfig({
        auto_reply_enabled: saved.auto_reply_enabled ?? false,
        reply_delay_seconds: saved.reply_delay_seconds ?? 3,
      });
    }
  }, [orgSettings]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      if (!orgSettings?.id) throw new Error('Organization settings not found');
      // Preserve any other keys already on the JSONB; only update ours.
      const existing = (orgSettings.whatsapp_ai_config as any) || {};
      const merged = {
        ...existing,
        auto_reply_enabled: config.auto_reply_enabled,
        reply_delay_seconds: config.reply_delay_seconds,
      };
      // Strip the deprecated persona key in case any old client wrote it back.
      delete merged.system_prompt;
      const { error } = await supabase
        .from('organization_settings')
        .update({ whatsapp_ai_config: merged as any })
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
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="p-1.5 rounded-lg bg-violet-500/10">
            <Bot className="h-4 w-4 text-violet-600" />
          </div>
          WhatsApp / Meta Auto-Reply
        </CardTitle>
        <CardDescription>
          Operational controls only. The persona is in <b>Purposes → whatsapp_reply</b>; offers, FAQs and
          rules are in the <b>Brain</b> tab and are shared with every AI handle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <Label className="font-semibold">Enable AI Auto-Reply</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              When enabled, the AI replies to incoming WhatsApp, Instagram and Messenger messages.
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
            onChange={(e) =>
              setConfig({ ...config, reply_delay_seconds: parseInt(e.target.value) || 0 })
            }
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            Wait this many seconds (0-30) before sending the reply. A short delay feels more natural.
          </p>
        </div>

        <div className="flex items-start gap-2 p-3 rounded-lg bg-indigo-50/60 border border-indigo-100">
          <Info className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
          <div className="text-xs text-slate-600 space-y-1">
            <p>
              <b>Looking for the persona / system prompt?</b> It moved to{' '}
              <b>Purposes → whatsapp_reply</b>.
            </p>
            <p>
              <b>Looking for seasonal offers, FAQs or talking points?</b> Add them in the{' '}
              <b>Brain</b> tab — they automatically apply to WhatsApp replies, lead nurture and every
              other AI handle.
            </p>
          </div>
        </div>

        <Button className="w-full" onClick={() => saveConfig.mutate()} disabled={saveConfig.isPending}>
          {saveConfig.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Auto-Reply Settings
        </Button>
      </CardContent>
    </Card>
  );
}
