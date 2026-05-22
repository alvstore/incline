// HandleOpsSettings — operational settings panel sourced from
// ai_purposes.ops_config. Replaces the legacy WhatsAppAISettings /
// LeadNurtureSettings / AIFlowBuilderSettings components that wrote to
// the now-removed organization_settings JSONB columns.
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

type OpsConfig = Record<string, any>;

interface Props {
  purposeId: string;
  purpose: string;
  opsConfig: OpsConfig;
}

const FIELDS: Record<
  string,
  Array<
    | { key: string; label: string; help?: string; type: 'switch' }
    | { key: string; label: string; help?: string; type: 'number'; min?: number; max?: number; step?: number }
  >
> = {
  whatsapp_reply: [
    { key: 'auto_reply_enabled', label: 'Auto-reply enabled', type: 'switch', help: 'Master switch for the WhatsApp / Meta brain.' },
    { key: 'reply_delay_seconds', label: 'Reply delay (seconds)', type: 'number', min: 0, max: 30, step: 1, help: 'Optional human-like pause before sending.' },
    { key: 'instagram_story_reply_enabled', label: 'Reply to Instagram story replies', type: 'switch' },
    { key: 'instagram_auto_reply_comments', label: 'Auto-reply Instagram comments', type: 'switch' },
  ],
  lead_nurture: [
    { key: 'enabled', label: 'Nurture nudges enabled', type: 'switch' },
    { key: 'delay_hours', label: 'Wait hours before first nudge', type: 'number', min: 1, max: 168, step: 1 },
    { key: 'max_retries', label: 'Max nudges per lead', type: 'number', min: 1, max: 10, step: 1 },
    { key: 'cooldown_hours', label: 'Cooldown between nudges (hours)', type: 'number', min: 1, max: 168, step: 1 },
  ],
};

export function HandleOpsSettings({ purposeId, purpose, opsConfig }: Props) {
  const qc = useQueryClient();
  const fields = FIELDS[purpose] ?? [];
  const [state, setState] = useState<OpsConfig>(opsConfig ?? {});

  useEffect(() => {
    setState(opsConfig ?? {});
  }, [purposeId, opsConfig]);

  const dirty = JSON.stringify(state) !== JSON.stringify(opsConfig ?? {});

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('ai_purposes')
        .update({ ops_config: state })
        .eq('id', purposeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Operational settings saved');
      qc.invalidateQueries({ queryKey: ['ai_purposes', 'global'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  if (fields.length === 0) {
    return <p className="text-xs text-slate-500">No operational settings for this handle.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.key} className="p-3 rounded-xl bg-slate-50 space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs font-semibold text-slate-700">{f.label}</Label>
              {f.type === 'switch' ? (
                <Switch
                  checked={Boolean(state[f.key])}
                  onCheckedChange={(v) => setState((s) => ({ ...s, [f.key]: v }))}
                />
              ) : (
                <Input
                  type="number"
                  min={f.min}
                  max={f.max}
                  step={f.step ?? 1}
                  value={state[f.key] ?? ''}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      [f.key]: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  className="font-mono text-xs h-8 w-24 text-right"
                />
              )}
            </div>
            {f.help && <p className="text-[11px] text-slate-500">{f.help}</p>}
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="gap-1.5"
        >
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save ops settings
        </Button>
      </div>
    </div>
  );
}
