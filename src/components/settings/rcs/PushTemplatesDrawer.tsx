/**
 * PushTemplatesDrawer — bulk-push local rcs_templates that have not been
 * uploaded to the active provider yet (external_template_id IS NULL).
 * Smartping is supported; Telinfy returns an unsupported reason.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, UploadCloud, CheckCircle2, AlertCircle, Image as ImageIcon, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

type PushableTemplate = {
  id: string;
  template_name: string;
  kind: string | null;
  body_preview: string | null;
  media_url: string | null;
  status: string | null;
};

export function PushTemplatesDrawer({
  open, onOpenChange, branchId, providerLabel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branchId: string | null;
  providerLabel: string;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const { data: templates, isLoading } = useQuery({
    enabled: open,
    queryKey: ['rcs-templates-pushable', branchId],
    queryFn: async () => {
      const q = supabase.from('rcs_templates')
        .select('id, template_name, kind, body_preview, media_url, status')
        .is('external_template_id', null)
        .order('template_name');
      const { data, error } = branchId
        ? await q.or(`branch_id.eq.${branchId},branch_id.is.null`)
        : await q.is('branch_id', null);
      if (error) throw error;
      return (data as PushableTemplate[]) ?? [];
    },
  });

  const selectedIds = useMemo(
    () => Object.keys(selected).filter((k) => selected[k]),
    [selected],
  );

  const pushMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await supabase.functions.invoke('rcs-templates-push', {
        body: { branch_id: branchId, template_ids: ids },
      });
      if (error) throw new Error(error.message);
      if (!(data as any)?.ok) throw new Error((data as any)?.reason || 'push_failed');
      return data as {
        pushed: number; total: number;
        results: { id: string; template_name: string; ok: boolean; reason?: string }[];
      };
    },
    onSuccess: (d) => {
      const failed = d.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success(`Pushed ${d.pushed}/${d.total} templates to ${providerLabel}`);
      } else {
        toast.warning(`Pushed ${d.pushed}/${d.total}. ${failed.length} failed.`, {
          description: failed.slice(0, 3).map((f) => `${f.template_name}: ${f.reason}`).join('\n'),
          duration: 10_000,
        });
      }
      setSelected({});
      qc.invalidateQueries({ queryKey: ['rcs-templates'] });
      qc.invalidateQueries({ queryKey: ['rcs-templates-pushable'] });
    },
    onError: (e: any) => toast.error(`Push failed: ${e.message}`),
  });

  const toggleAll = (v: boolean) => {
    const next: Record<string, boolean> = {};
    (templates ?? []).forEach((t) => { next[t.id] = v; });
    setSelected(next);
  };
  const allSelected = (templates?.length ?? 0) > 0 && selectedIds.length === (templates?.length ?? 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-indigo-600" />
            Push templates to {providerLabel}
          </SheetTitle>
          <SheetDescription>
            Local templates that don't yet exist on {providerLabel}. Selected rows will be
            uploaded and marked as <span className="font-mono">pending_approval</span>.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-3">
          {isLoading ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : !templates || templates.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-900">All templates are already on {providerLabel}.</p>
              <p className="text-xs text-slate-500 mt-1">Nothing left to push.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-1">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => toggleAll(!!v)}
                  id="push-all"
                />
                <label htmlFor="push-all" className="text-xs font-semibold uppercase tracking-wider text-slate-500 cursor-pointer">
                  Select all ({templates.length})
                </label>
              </div>
              {templates.map((t) => {
                const isRich = !!t.kind && t.kind.startsWith('rich');
                const missingMedia = isRich && !t.media_url;
                const missingBody = !t.body_preview?.trim();
                const blocked = missingMedia || missingBody;
                return (
                  <label
                    key={t.id}
                    className={`flex gap-3 rounded-2xl border p-3 transition ${
                      selected[t.id] ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 bg-white'
                    } ${blocked ? 'opacity-60' : 'cursor-pointer hover:border-slate-300'}`}
                  >
                    <Checkbox
                      checked={!!selected[t.id]}
                      disabled={blocked}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [t.id]: !!v }))}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {isRich ? (
                          <Badge className="bg-indigo-100 text-indigo-700 text-[10px]"><ImageIcon className="h-2.5 w-2.5 mr-0.5" />Rich</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />Basic</Badge>
                        )}
                        <span className="font-semibold text-slate-900 truncate">{t.template_name}</span>
                      </div>
                      {t.body_preview && (
                        <p className="text-xs text-slate-600 line-clamp-2 mt-1">{t.body_preview}</p>
                      )}
                      {blocked && (
                        <p className="text-xs text-amber-700 flex items-start gap-1 mt-1.5">
                          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          {missingBody ? 'Body is empty. ' : ''}
                          {missingMedia ? 'Rich template needs a public https media URL.' : ''}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </>
          )}
        </div>

        <SheetFooter className="border-t pt-4 flex-row justify-between gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pushMut.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => pushMut.mutate(selectedIds)}
            disabled={pushMut.isPending || selectedIds.length === 0}
          >
            {pushMut.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Pushing…</>
            ) : (
              <><UploadCloud className="h-4 w-4 mr-2" />Push {selectedIds.length || ''} to {providerLabel}</>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
