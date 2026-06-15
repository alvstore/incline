// Right-side Sheet for creating/editing an ai_dynamic_memory rule.
// Project policy: "No Dialog" for data entry — use Sheet + RHF + Zod.
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';

const INTENT_OPTIONS = [
  { value: 'location', label: 'Location' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'handoff', label: 'Human Handoff' },
  { value: 'decline', label: 'Decline / Opt-out' },
  { value: 'name_block', label: 'Block as Name' },
  { value: 'custom', label: 'Custom' },
] as const;

const schema = z.object({
  phrase_or_pattern: z.string().trim().min(1, 'Required').max(200),
  intent_category: z.enum(['location', 'pricing', 'timeline', 'handoff', 'decline', 'name_block', 'custom']),
  correction_instruction: z.string().trim().min(5, 'At least 5 chars').max(800),
  match_type: z.enum(['exact', 'contains', 'regex']),
  priority: z.coerce.number().int().min(0).max(1000),
  is_active: z.boolean(),
});
export type RuleFormValues = z.infer<typeof schema>;

export interface AITrainingRule extends RuleFormValues { id: string; }

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: AITrainingRule | null;
}

export function AITrainingRuleSheet({ open, onOpenChange, rule }: Props) {
  const qc = useQueryClient();
  const isEdit = !!rule;

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      phrase_or_pattern: '',
      intent_category: 'custom',
      correction_instruction: '',
      match_type: 'contains',
      priority: 100,
      is_active: true,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset(rule ?? {
        phrase_or_pattern: '',
        intent_category: 'custom',
        correction_instruction: '',
        match_type: 'contains',
        priority: 100,
        is_active: true,
      });
    }
  }, [open, rule, form]);

  const save = useMutation({
    mutationFn: async (values: RuleFormValues) => {
      const payload = values as Required<RuleFormValues>;
      if (isEdit && rule) {
        const { error } = await supabase.from('ai_dynamic_memory').update(payload).eq('id', rule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ai_dynamic_memory').insert([payload]);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai_dynamic_memory'] });
      toast.success(isEdit ? 'Rule updated' : 'Rule added');
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || 'Save failed'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b">
          <SheetTitle>{isEdit ? 'Edit Training Rule' : 'Add Training Rule'}</SheetTitle>
          <SheetDescription>
            Teach the AI a new phrase or pattern. Rules apply instantly across WhatsApp & Instagram (60s cache).
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="phrase">Phrase or Pattern</Label>
            <Input
              id="phrase"
              placeholder="e.g. kha pr h"
              {...form.register('phrase_or_pattern')}
            />
            {form.formState.errors.phrase_or_pattern && (
              <p className="text-xs text-destructive">{form.formState.errors.phrase_or_pattern.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Intent Category</Label>
              <Select
                value={form.watch('intent_category')}
                onValueChange={(v) => form.setValue('intent_category', v as RuleFormValues['intent_category'], { shouldDirty: true })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTENT_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Match Type</Label>
              <Select
                value={form.watch('match_type')}
                onValueChange={(v) => form.setValue('match_type', v as RuleFormValues['match_type'], { shouldDirty: true })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">Contains</SelectItem>
                  <SelectItem value="exact">Exact</SelectItem>
                  <SelectItem value="regex">Regex</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="instruction">Correction Instruction</Label>
            <Textarea
              id="instruction"
              rows={5}
              placeholder="What should the AI do when it sees this phrase? e.g. Answer location is Sector 14, Udaipur. Do not save as name."
              {...form.register('correction_instruction')}
            />
            {form.formState.errors.correction_instruction && (
              <p className="text-xs text-destructive">{form.formState.errors.correction_instruction.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-2">
              <Label htmlFor="priority">Priority (higher wins)</Label>
              <Input id="priority" type="number" min={0} max={1000} {...form.register('priority')} />
            </div>
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <Label htmlFor="is_active" className="cursor-pointer">Active</Label>
                <p className="text-xs text-muted-foreground">Off = ignored by AI</p>
              </div>
              <Switch
                id="is_active"
                checked={form.watch('is_active')}
                onCheckedChange={(v) => form.setValue('is_active', v, { shouldDirty: true })}
              />
            </div>
          </div>
        </form>

        <SheetFooter className="px-6 py-4 border-t bg-muted/30">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={form.handleSubmit((v) => save.mutate(v))} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Add Rule'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
