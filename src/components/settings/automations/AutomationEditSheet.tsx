import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Bot, Sparkles, Lock, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { CRON_PRESETS, describeCron, nextRuns } from '@/lib/automations/cronHumanize';
import type { AutomationRule } from './types';

interface Props {
  rule: AutomationRule | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AutomationEditSheet({ rule, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cron, setCron] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [tone, setTone] = useState('friendly');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!rule) return;
    setName(rule.name);
    setDesc(rule.description ?? '');
    setCron(rule.cron_expression);
    setUseAi(rule.use_ai);
    setTone(rule.ai_tone ?? 'friendly');
  }, [rule?.id]);

  if (!rule) return null;

  const preview = nextRuns(cron, new Date(), 3);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc('admin_update_automation_rule' as any, {
      _rule_id: rule.id,
      _cron_expression: cron,
      _use_ai: useAi,
      _ai_tone: tone,
      _target_filter: rule.target_filter ?? {},
      _name: name,
      _description: desc,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success('Automation updated');
    onSaved();
  };

  return (
    <Sheet open={!!rule} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-violet-600" /> Edit automation
          </SheetTitle>
          <SheetDescription>
            Adjust schedule, enable AI personalisation, or rename. Changes apply on the next tick.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-5">
          <section className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Identity</p>
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="rounded-xl" />
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Schedule</p>
            <div>
              <Label>Preset</Label>
              <Select value={cron} onValueChange={setCron}>
                <SelectTrigger className="rounded-xl"><SelectValue placeholder="Pick a preset…" /></SelectTrigger>
                <SelectContent>
                  {CRON_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label} <span className="text-slate-400 ml-2 font-mono text-xs">{p.value}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Custom cron expression</Label>
              <Input value={cron} onChange={(e) => setCron(e.target.value)} className="rounded-xl font-mono" placeholder="m h dom mon dow" />
              <p className="text-xs text-slate-500 mt-1">{describeCron(cron)}</p>
            </div>
            {preview.length > 0 && (
              <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold flex items-center gap-1.5"><Clock className="h-3 w-3" /> Next runs (UTC)</p>
                <ul className="mt-1.5 space-y-0.5 font-mono">
                  {preview.map((d, i) => (
                    <li key={i}>{format(d, 'MMM d HH:mm')}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">AI personalisation</p>
            <div className="flex items-center justify-between rounded-xl bg-violet-50/60 p-4">
              <div className="flex-1">
                <p className="font-semibold text-slate-900 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-violet-600" /> Use AI Brain
                </p>
                <p className="text-xs text-slate-600 mt-1">Personalise message copy per recipient.</p>
              </div>
              <Switch checked={useAi} onCheckedChange={setUseAi} />
            </div>
            {useAi && (
              <div>
                <Label>Tone</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="motivational">Motivational</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </section>

          <div className="rounded-xl bg-slate-50 p-4 text-xs text-slate-600 space-y-1">
            <p><span className="font-semibold">Worker:</span> <span className="font-mono">{rule.worker}</span></p>
            <p><span className="font-semibold">Key:</span> <span className="font-mono">{rule.key}</span></p>
            {rule.is_system && (
              <p className="text-amber-700 flex items-center gap-1 mt-1">
                <Lock className="h-3 w-3" />
                System automation — worker cannot be changed.
              </p>
            )}
          </div>
        </div>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
          <Button onClick={save} disabled={saving} className="rounded-xl bg-violet-600 hover:bg-violet-700">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
