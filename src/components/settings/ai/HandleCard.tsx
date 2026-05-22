// HandleCard — single editor for one ai_purposes row.
// Replaces the dual-editor pattern (persona stub + collapsible AIPurposesTab).
// Sections: Persona & tone (inline editable) · Knowledge in use · Operational settings · Test.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Loader2,
  Save,
  Sparkles,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { KnowledgeForHandle } from './KnowledgeForHandle';

export interface PurposeRow {
  id: string;
  branch_id: string | null;
  purpose: string;
  enabled: boolean;
  provider_id: string | null;
  model: string | null;
  system_prompt: string;
  temperature: number | null;
  max_tokens: number | null;
  updated_at: string;
}

interface HandleMeta {
  title: string;
  desc: string;
  channel: string;
}

interface ProviderOption {
  id: string;
  provider: string;
  default_model: string;
  is_default: boolean;
}

interface Props {
  row: PurposeRow;
  meta: HandleMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onJumpToKnowledge?: () => void;
  /** Extra operational panel rendered below knowledge (e.g. auto-reply, cadence). */
  opsSlot?: React.ReactNode;
}

export function HandleCard({ row, meta, open, onOpenChange, onJumpToKnowledge, opsSlot }: Props) {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(row.enabled);
  const [systemPrompt, setSystemPrompt] = useState(row.system_prompt ?? '');
  const [providerId, setProviderId] = useState<string | null>(row.provider_id);
  const [model, setModel] = useState<string>(row.model ?? '');
  const [temperature, setTemperature] = useState<string>(
    row.temperature !== null && row.temperature !== undefined ? String(row.temperature) : '0.6',
  );
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setEnabled(row.enabled);
    setSystemPrompt(row.system_prompt ?? '');
    setProviderId(row.provider_id);
    setModel(row.model ?? '');
    setTemperature(
      row.temperature !== null && row.temperature !== undefined ? String(row.temperature) : '0.6',
    );
  }, [row.id, row.updated_at]);

  const { data: providers = [] } = useQuery({
    queryKey: ['ai_provider_configs', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_provider_configs')
        .select('id, provider, default_model, is_default, is_active')
        .eq('is_active', true)
        .order('is_default', { ascending: false });
      if (error) throw error;
      return ((data as any[]) ?? []) as ProviderOption[];
    },
  });

  const dirty =
    enabled !== row.enabled ||
    (systemPrompt ?? '') !== (row.system_prompt ?? '') ||
    (providerId ?? null) !== (row.provider_id ?? null) ||
    (model ?? '') !== (row.model ?? '') ||
    Number(temperature) !== (row.temperature ?? 0.6);

  const save = useMutation({
    mutationFn: async () => {
      const tempNum = Number(temperature);
      const { error } = await supabase
        .from('ai_purposes')
        .update({
          enabled,
          system_prompt: systemPrompt,
          provider_id: providerId,
          model: model || null,
          temperature: Number.isFinite(tempNum) ? tempNum : 0.6,
        })
        .eq('id', row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Handle saved');
      qc.invalidateQueries({ queryKey: ['ai_purposes', 'global'] });
    },
    onError: (e: any) => toast.error(e.message || 'Failed to save'),
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-test-purpose', {
        body: { purpose: row.purpose },
      });
      if (error) throw error;
      if (data?.success) {
        const label = `${data.provider} · ${data.model} · ${data.latency_ms}ms`;
        if (data.fallback_used) {
          toast.warning(`${label} (fallback to Lovable)`, {
            description: 'Primary provider failed — check Plumbing → Logs.',
          });
        } else {
          toast.success(label, { description: data.sample?.slice(0, 120) || undefined });
        }
      } else {
        toast.error(data?.error || 'Test failed');
      }
    } catch (e: any) {
      toast.error(e.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const selectedProvider = providers.find((p) => p.id === providerId);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <Card
        className={`rounded-2xl shadow-lg shadow-slate-200/50 transition-all ${
          open ? 'ring-1 ring-indigo-200' : 'hover:shadow-xl hover:shadow-indigo-500/10'
        }`}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full text-left p-4 sm:p-5 flex items-start gap-3 sm:gap-4"
          >
            <div
              className={`shrink-0 p-2.5 rounded-xl ${
                enabled
                  ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/20'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              <Bot className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-slate-900">{meta.title}</h3>
                {enabled ? (
                  <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                    Live
                  </Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-100">
                    Disabled
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px]">
                  {meta.channel}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-mono gap-1">
                  <Zap className="h-3 w-3 text-violet-600" />
                  {model || selectedProvider?.default_model || 'provider default'}
                </Badge>
                {dirty && (
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px]">
                    Unsaved
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">{meta.desc}</p>
            </div>
            <div className="hidden sm:flex items-center gap-1 shrink-0 text-slate-400">
              {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-4 sm:px-5 pb-5 space-y-6 border-t pt-5">
            {/* Status row */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50">
              <div className="flex items-center gap-2">
                <Switch
                  id={`enabled-${row.id}`}
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
                <Label htmlFor={`enabled-${row.id}`} className="text-sm cursor-pointer">
                  Handle is {enabled ? 'live' : 'disabled'}
                </Label>
              </div>
              <span className="text-[11px] text-slate-400">
                Last updated {new Date(row.updated_at).toLocaleString()}
              </span>
            </div>

            {/* Persona & tone — inline editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                  Persona & tone
                </Label>
                <span className="text-[11px] text-slate-400">
                  {systemPrompt.length} chars
                </span>
              </div>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={6}
                placeholder="Voice, tone and behavioural rules unique to this handle. Keep it short — facts live in Knowledge."
                className="font-mono text-xs leading-relaxed"
              />
              <p className="text-[11px] text-slate-500">
                Keep this short. Offers, FAQs and shared rules belong in the{' '}
                <button
                  type="button"
                  className="underline text-indigo-600 hover:text-indigo-700"
                  onClick={onJumpToKnowledge}
                >
                  Knowledge tab
                </button>{' '}
                so every AI handle stays consistent.
              </p>
            </div>

            {/* Model & sampling */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Provider</Label>
                <Select
                  value={providerId ?? '__default__'}
                  onValueChange={(v) => setProviderId(v === '__default__' ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Use organization default</SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.provider}
                        {p.is_default ? ' (default)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Model</Label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={selectedProvider?.default_model || 'provider default'}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Temperature</Label>
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {/* Knowledge in use (shared store) */}
            <KnowledgeForHandle purpose={row.purpose} onOpenKnowledge={onJumpToKnowledge} />

            {/* Operational settings — only handles that own one render here */}
            {opsSlot && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Operational settings
                </Label>
                {opsSlot}
              </div>
            )}

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleTest}
                disabled={testing}
                className="gap-1.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FlaskConical className="h-3.5 w-3.5" />
                )}
                Test handle
              </Button>
              <Button
                size="sm"
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
                className="gap-1.5"
              >
                {save.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save handle
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
