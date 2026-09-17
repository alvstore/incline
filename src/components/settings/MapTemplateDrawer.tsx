import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/hooks/use-toast';
import { CheckCircle2, Link2, Loader2, Search } from 'lucide-react';
import type { EventChannel } from '@/lib/templates/systemEvents';

interface TemplateRow {
  id: string;
  name: string;
  content: string | null;
  trigger_event: string | null;
  is_active: boolean | null;
  meta_template_name: string | null;
  meta_template_status: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: EventChannel;
  /** System event being mapped, e.g. `facility_reminder`. */
  event: string | null;
  eventLabel?: string;
  currentTemplateId?: string | null;
}

export function MapTemplateDrawer({
  open, onOpenChange, channel, event, eventLabel, currentTemplateId,
}: Props) {
  const qc = useQueryClient();
  const { effectiveBranchId } = useBranchContext();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(currentTemplateId ?? null);

  // Drawer stays mounted across events — re-sync the selection each time it
  // opens so a previous event's pick is never carried over.
  useEffect(() => {
    if (open) {
      setSelected(currentTemplateId ?? null);
      setSearch('');
    }
  }, [open, event, currentTemplateId]);

  const { data: templates, isLoading, isError } = useQuery({
    queryKey: ['mappable-templates', channel],
    queryFn: async (): Promise<TemplateRow[]> => {
      const { data, error } = await supabase
        .from('templates')
        .select('id, name, content, trigger_event, is_active, meta_template_name, meta_template_status')
        .eq('type', channel)
        .order('name');
      if (error) throw error;
      return (data || []) as TemplateRow[];
    },
    enabled: open,
  });

  const eligible = useMemo(() => {
    const list = (templates || []).filter((t) =>
      channel === 'whatsapp'
        ? (t.meta_template_status || '').toUpperCase() === 'APPROVED'
        : true,
    );
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.content || '').toLowerCase().includes(q) ||
        (t.meta_template_name || '').toLowerCase().includes(q),
    );
  }, [templates, channel, search]);

  const save = useMutation({
    mutationFn: async () => {
      if (!event || !selected) throw new Error('Pick a template first');
      if (channel === 'whatsapp') {
        if (!effectiveBranchId) throw new Error('Select a branch first');
        const { data: existing } = await supabase
          .from('whatsapp_triggers')
          .select('id')
          .eq('branch_id', effectiveBranchId)
          .eq('event_name', event)
          .maybeSingle();
        if (existing?.id) {
          const { error } = await supabase
            .from('whatsapp_triggers')
            .update({ template_id: selected, is_active: true })
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('whatsapp_triggers')
            .insert({
              branch_id: effectiveBranchId,
              event_name: event,
              template_id: selected,
              is_active: true,
            });
          if (error) throw error;
        }
      } else {
        const { error } = await supabase
          .from('templates')
          .update({ trigger_event: event, is_active: true })
          .eq('id', selected);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: 'Template mapped', description: `${eventLabel || event} will now use this message.` });
      qc.invalidateQueries({ queryKey: ['template-coverage'] });
      qc.invalidateQueries({ queryKey: ['mappable-templates'] });
      onOpenChange(false);
    },
    onError: (e: Error) =>
      toast({ title: 'Could not map template', description: e.message, variant: 'destructive' }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
          <SheetTitle className="flex items-center gap-2 text-slate-900">
            <span className="bg-indigo-50 text-indigo-600 p-2 rounded-full">
              <Link2 className="h-4 w-4" />
            </span>
            Map template
          </SheetTitle>
          <SheetDescription className="text-sm text-slate-500">
            Choose which approved message is sent for{' '}
            <span className="font-semibold text-slate-700">{eventLabel || event}</span>. One template
            can serve several events — reuse a generic utility message when you do not need
            dedicated copy.
          </SheetDescription>
        </SheetHeader>

        <div className="px-6 py-4 border-b border-slate-100">
          <Label htmlFor="tpl-search" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Search templates
          </Label>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              id="tpl-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or message text"
              className="pl-9 rounded-xl focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-3">
            {isLoading && (
              <>
                <Skeleton className="h-20 w-full rounded-2xl" />
                <Skeleton className="h-20 w-full rounded-2xl" />
                <Skeleton className="h-20 w-full rounded-2xl" />
              </>
            )}
            {isError && (
              <p className="text-sm text-red-600">Could not load templates. Please try again.</p>
            )}
            {!isLoading && !isError && eligible.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm font-semibold text-slate-700">No approved templates yet</p>
                <p className="text-sm text-slate-500 mt-1">
                  Create one from the Studio, then map it here once it is approved.
                </p>
              </div>
            )}
            {eligible.map((t) => {
              const active = selected === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t.id)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    active
                      ? 'border-indigo-300 bg-indigo-50/60 shadow-lg shadow-indigo-500/10'
                      : 'border-slate-100 bg-white hover:shadow-lg hover:shadow-slate-200/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">{t.name}</p>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                        {t.content || 'No preview available'}
                      </p>
                    </div>
                    {active && <CheckCircle2 className="h-5 w-5 text-indigo-600 shrink-0" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-3">
                    {t.trigger_event && (
                      <Badge className="bg-slate-100 text-slate-600 rounded-full px-2.5 py-0.5 text-[10px] font-medium border-0">
                        {t.trigger_event}
                      </Badge>
                    )}
                    {t.is_active === false && (
                      <Badge className="bg-amber-100 text-amber-700 rounded-full px-2.5 py-0.5 text-[10px] font-medium border-0">
                        Inactive — will be switched on
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-white">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
            disabled={!selected || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save mapping
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
