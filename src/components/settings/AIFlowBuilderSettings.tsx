import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Brain, Save, Loader2, X, Plus, Trash2, Zap, GripVertical, Play, ArrowDown, MousePointerClick } from 'lucide-react';

const REQUIRED_FIELDS = ['name', 'email'];

const AVAILABLE_FIELDS = [
  { id: 'name', label: 'Name', required: true },
  { id: 'phone', label: 'Phone', required: false },
  { id: 'email', label: 'Email', required: true },
  { id: 'goal', label: 'Fitness Goal', required: false },
  { id: 'plan_interest', label: 'Interested Plan Duration', required: false },
  { id: 'budget', label: 'Budget', required: false },
  { id: 'start_date', label: 'Expected Start Date', required: false },
  { id: 'experience', label: 'Fitness Experience', required: false },
  { id: 'preferred_time', label: 'Preferred Time', required: false },
];

const DEFAULT_HANDOFF = "Thanks for sharing! Our team will reach out to you shortly. 💪";

interface LeadCaptureConfig {
  enabled: boolean;
  target_fields: string[];
  handoff_message: string;
}

interface InteractiveButton {
  id: string;
  title: string;
}

interface FlowRule {
  id: string;
  trigger_keywords: string[];
  action_type: 'send_text' | 'send_template' | 'assign_staff' | 'send_interactive';
  response_text: string;
  template_name?: string;
  interactive_buttons?: InteractiveButton[];
  is_active: boolean;
}

export function AIFlowBuilderSettings() {
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<LeadCaptureConfig>({
    enabled: false,
    target_fields: ['name', 'goal'],
    handoff_message: DEFAULT_HANDOFF,
  });
  const [flowRules, setFlowRules] = useState<FlowRule[]>([]);
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<{ matched: boolean; rule?: FlowRule } | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const { data: orgSettings, isLoading } = useQuery({
    queryKey: ['org-settings-ai-flow'],
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
      if (saved.lead_capture) {
        setConfig({
          enabled: saved.lead_capture.enabled ?? false,
          target_fields: saved.lead_capture.target_fields ?? ['name', 'goal'],
          handoff_message: saved.lead_capture.handoff_message || DEFAULT_HANDOFF,
        });
      }
      if (saved.ai_flow_rules && Array.isArray(saved.ai_flow_rules)) {
        setFlowRules(saved.ai_flow_rules);
      }
    }
  }, [orgSettings]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      if (!orgSettings?.id) throw new Error('Organization settings not found');
      const existing = (orgSettings.whatsapp_ai_config as any) || {};
      const updated = { ...existing, lead_capture: config, ai_flow_rules: flowRules };
      const { error } = await supabase
        .from('organization_settings')
        .update({ whatsapp_ai_config: updated as any })
        .eq('id', orgSettings.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('AI Lead Capture & Flow Rules saved');
      queryClient.invalidateQueries({ queryKey: ['org-settings-ai-flow'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to save'),
  });

  const toggleField = (fieldId: string) => {
    if (REQUIRED_FIELDS.includes(fieldId) && config.target_fields.includes(fieldId)) return;
    setConfig(prev => ({
      ...prev,
      target_fields: prev.target_fields.includes(fieldId)
        ? prev.target_fields.filter(f => f !== fieldId)
        : [...prev.target_fields, fieldId],
    }));
  };

  const addFlowRule = () => {
    setFlowRules(prev => [...prev, {
      id: crypto.randomUUID(),
      trigger_keywords: [],
      action_type: 'send_text',
      response_text: '',
      interactive_buttons: [],
      is_active: true,
    }]);
  };

  const updateFlowRule = (id: string, updates: Partial<FlowRule>) => {
    setFlowRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const removeFlowRule = (id: string) => {
    setFlowRules(prev => prev.filter(r => r.id !== id));
  };

  // Interactive buttons helpers
  const addButton = (ruleId: string) => {
    setFlowRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      const buttons = r.interactive_buttons || [];
      if (buttons.length >= 3) return r;
      return { ...r, interactive_buttons: [...buttons, { id: crypto.randomUUID().slice(0, 8), title: '' }] };
    }));
  };

  const updateButton = (ruleId: string, btnIdx: number, title: string) => {
    setFlowRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      const buttons = [...(r.interactive_buttons || [])];
      buttons[btnIdx] = { ...buttons[btnIdx], title };
      return { ...r, interactive_buttons: buttons };
    }));
  };

  const removeButton = (ruleId: string, btnIdx: number) => {
    setFlowRules(prev => prev.map(r => {
      if (r.id !== ruleId) return r;
      const buttons = (r.interactive_buttons || []).filter((_, i) => i !== btnIdx);
      return { ...r, interactive_buttons: buttons };
    }));
  };

  // Drag reorder
  const handleDragStart = (index: number) => { dragItem.current = index; };
  const handleDragEnter = (index: number) => { dragOverItem.current = index; };
  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const items = [...flowRules];
    const draggedItem = items[dragItem.current];
    items.splice(dragItem.current, 1);
    items.splice(dragOverItem.current, 0, draggedItem);
    setFlowRules(items);
    dragItem.current = null;
    dragOverItem.current = null;
  };

  // Test rule dry-run
  const testRules = useCallback(() => {
    if (!testInput.trim()) return;
    const lower = testInput.toLowerCase();
    const matched = flowRules.find(r =>
      r.is_active && r.trigger_keywords.some(kw => lower.includes(kw.toLowerCase()))
    );
    setTestResult(matched ? { matched: true, rule: matched } : { matched: false });
  }, [testInput, flowRules]);

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
    <div className="space-y-6">
      {/* Lead Capture Rules */}
      <Card className="rounded-xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-lg bg-indigo-500/10">
              <Brain className="h-4 w-4 text-indigo-600" />
            </div>
            AI Lead Capture Rules
          </CardTitle>
          <CardDescription>
            Configure how the AI chatbot qualifies and captures leads automatically from WhatsApp conversations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <Label className="font-semibold">Enable AI Lead Capture</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                When enabled, the AI will naturally collect lead information and auto-create leads in your CRM.
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => setConfig({ ...config, enabled: v })}
            />
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">Target Fields to Collect</Label>
            <p className="text-xs text-muted-foreground">
              Select which information the AI should gather from the prospect during conversation.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {AVAILABLE_FIELDS.map(field => {
                const isSelected = config.target_fields.includes(field.id);
                const isRequired = REQUIRED_FIELDS.includes(field.id);
                return (
                  <Badge
                    key={field.id}
                    variant={isSelected ? 'default' : 'outline'}
                    className={`cursor-pointer transition-all text-xs px-3 py-1.5 rounded-lg ${
                      isSelected
                        ? isRequired ? 'bg-indigo-600 text-white cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        : 'hover:bg-muted'
                    }`}
                    onClick={() => toggleField(field.id)}
                  >
                    {field.label}{isRequired ? ' *' : ''}
                    {isSelected && !isRequired && <X className="h-3 w-3 ml-1" />}
                  </Badge>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">Handoff Message</Label>
            <Textarea
              rows={3}
              value={config.handoff_message}
              onChange={(e) => setConfig({ ...config, handoff_message: e.target.value })}
              placeholder="Message sent after lead is captured..."
              className="text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* AI Flow Rules (Trigger-Response) */}
      <Card className="rounded-xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <div className="p-1.5 rounded-lg bg-amber-500/10">
              <Zap className="h-4 w-4 text-amber-600" />
            </div>
            AI Flow Rules
            {flowRules.length > 0 && (
              <Badge variant="secondary" className="ml-2 text-xs">{flowRules.length} rules</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Define keyword triggers that bypass the AI and send specific responses. Rules are checked in order — drag to re-prioritize.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Test Rule Section */}
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label className="text-xs font-semibold">Test Message</Label>
              <Input
                placeholder='Type a sample message like "What is the price?"'
                value={testInput}
                onChange={(e) => { setTestInput(e.target.value); setTestResult(null); }}
                className="text-sm"
              />
            </div>
            <Button variant="outline" size="sm" onClick={testRules} className="gap-1 shrink-0">
              <Play className="h-3.5 w-3.5" /> Test
            </Button>
          </div>
          {testResult && (
            <div className={`text-xs p-2 rounded-lg border ${testResult.matched ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700' : 'bg-muted border-border text-muted-foreground'}`}>
              {testResult.matched
                ? <>✅ Matched rule: <strong>{testResult.rule?.trigger_keywords.join(', ')}</strong> → {testResult.rule?.action_type}</>
                : '❌ No rule matched — AI will process normally'
              }
            </div>
          )}

          {/* Visual Flow Preview */}
          {flowRules.map((rule, index) => (
            <div key={rule.id}>
              {index > 0 && (
                <div className="flex justify-center py-1">
                  <ArrowDown className="h-4 w-4 text-muted-foreground/40" />
                </div>
              )}
              <div
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className="relative"
              >
                {/* Priority indicator */}
                <div className="absolute -left-1 top-3 flex items-center gap-0.5">
                  <span className="text-[10px] font-bold text-muted-foreground/50 bg-muted rounded-full w-5 h-5 flex items-center justify-center">
                    {index + 1}
                  </span>
                </div>

                <Card className={`ml-5 border-dashed transition-all ${rule.is_active ? 'bg-card' : 'bg-muted/30 opacity-60'}`}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab" />
                        <Switch
                          checked={rule.is_active}
                          onCheckedChange={(v) => updateFlowRule(rule.id, { is_active: v })}
                          className="scale-75"
                        />
                        <span className="text-xs text-muted-foreground">{rule.is_active ? 'Active' : 'Disabled'}</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeFlowRule(rule.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {/* Trigger */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">🎯 Trigger Keywords</Label>
                      <Input
                        placeholder="price, fees, cost (comma-separated)"
                        value={rule.trigger_keywords.join(', ')}
                        onChange={(e) => updateFlowRule(rule.id, {
                          trigger_keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean)
                        })}
                        className="text-sm"
                      />
                    </div>

                    {/* Action */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">⚡ Action</Label>
                        <Select value={rule.action_type} onValueChange={(v: any) => updateFlowRule(rule.id, { action_type: v })}>
                          <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="send_text">Send Text Reply</SelectItem>
                            <SelectItem value="send_template">Send Template</SelectItem>
                            <SelectItem value="send_interactive">Send Interactive Buttons</SelectItem>
                            <SelectItem value="assign_staff">Assign to Staff</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {rule.action_type === 'send_template' && (
                        <div className="space-y-1.5">
                          <Label className="text-xs font-semibold">Template Name</Label>
                          <Input
                            placeholder="pricing_pdf"
                            value={rule.template_name || ''}
                            onChange={(e) => updateFlowRule(rule.id, { template_name: e.target.value })}
                            className="text-sm"
                          />
                        </div>
                      )}
                    </div>

                    {/* Response Text */}
                    {rule.action_type !== 'assign_staff' && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">💬 Response Text</Label>
                        <Textarea
                          rows={2}
                          value={rule.response_text}
                          onChange={(e) => updateFlowRule(rule.id, { response_text: e.target.value })}
                          placeholder="Here are our membership plans..."
                          className="text-sm"
                        />
                      </div>
                    )}

                    {/* Interactive Buttons Section */}
                    {(rule.action_type === 'send_interactive' || rule.action_type === 'send_text') && (
                      <div className="space-y-2 p-3 rounded-lg bg-muted/50 border border-dashed">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold flex items-center gap-1.5">
                            <MousePointerClick className="h-3.5 w-3.5 text-primary" />
                            WhatsApp Reply Buttons
                            <span className="text-muted-foreground font-normal">(max 3)</span>
                          </Label>
                          {(rule.interactive_buttons?.length || 0) < 3 && (
                            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => addButton(rule.id)}>
                              <Plus className="h-3 w-3" /> Add
                            </Button>
                          )}
                        </div>
                        {(rule.interactive_buttons || []).map((btn, btnIdx) => (
                          <div key={btn.id} className="flex gap-2 items-center">
                            <Badge variant="outline" className="shrink-0 text-[10px] w-5 h-5 flex items-center justify-center p-0 rounded-full">
                              {btnIdx + 1}
                            </Badge>
                            <Input
                              placeholder={btnIdx === 0 ? 'e.g. Weight Loss' : btnIdx === 1 ? 'e.g. Muscle Gain' : 'e.g. General Fitness'}
                              value={btn.title}
                              onChange={(e) => updateButton(rule.id, btnIdx, e.target.value.slice(0, 20))}
                              className="text-sm h-8"
                              maxLength={20}
                            />
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => removeButton(rule.id, btnIdx)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        {(rule.interactive_buttons?.length || 0) === 0 && (
                          <p className="text-xs text-muted-foreground italic">No buttons defined. Add up to 3 quick reply buttons.</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          ))}

          <Button variant="outline" size="sm" onClick={addFlowRule} className="w-full gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Add Flow Rule
          </Button>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button
        className="w-full"
        onClick={() => saveConfig.mutate()}
        disabled={saveConfig.isPending || config.target_fields.length === 0}
      >
        {saveConfig.isPending ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        Save Lead Capture & Flow Rules
      </Button>
    </div>
  );
}
