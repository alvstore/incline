import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useBranchContext } from '@/contexts/BranchContext';
import { can } from '@/lib/auth/permissions';
import { msg91RegisterBlocker, msg91StatusLabel } from '@/lib/templates/msg91Status';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { Info, Loader2, RefreshCw, History, UploadCloud, CheckCircle } from 'lucide-react';
import type { TemplateRow } from './TemplateTable';

interface FnResult { success?: boolean; ok?: boolean; error?: string; total?: number; synced?: number; versions?: Msg91Version[] }
interface Msg91Version { id?: string | number; template?: string; status?: string | number; is_active?: boolean | number; created_at?: string }

async function callMsg91(body: Record<string, unknown>): Promise<FnResult> {
  const { data, error } = await supabase.functions.invoke('msg91-templates', { body });
  if (error) {
    let detail = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) detail = j.error; } catch { /* keep message */ }
    throw new Error(detail);
  }
  return data as FnResult;
}

function useCanSync() {
  const { roles } = useAuth();
  return can.syncSmsTemplates(roles);
}

const TONE: Record<string, string> = {
  success: 'border-success/20 bg-success/10 text-success',
  warning: 'border-warning/20 bg-warning/10 text-warning',
  danger: 'border-destructive/20 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
};

export function Msg91Notice() {
  return (
    <div role="note" className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
      <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      <p>
        DLT approval happens in <strong className="text-foreground">SmartPing</strong> first. Once a template has its approved
        DLT Template ID and header, sync it to MSG91 so MSG91 can send it. MSG91 sync does not approve anything with operators.
      </p>
    </div>
  );
}

export function Msg91BulkSync() {
  const qc = useQueryClient();
  const allowed = useCanSync();
  const { effectiveBranchId } = useBranchContext();
  const m = useMutation({
    mutationFn: () => callMsg91({ action: 'bulk_sync', branch_id: effectiveBranchId || null }),
    onSuccess: (r) => {
      toast.success(`MSG91 sync: ${r.synced ?? 0} of ${r.total ?? 0} templates synced`);
      qc.invalidateQueries({ queryKey: ['communication-templates'] });
    },
    onError: (e: Error) => toast.error(`MSG91 sync failed: ${e.message}`),
  });
  if (!allowed) return null;
  return (
    <Button
      type="button" variant="outline" size="sm" className="rounded-xl min-h-[44px] sm:min-h-0"
      onClick={() => m.mutate()} disabled={m.isPending}
    >
      {m.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-4 w-4 mr-1.5" aria-hidden="true" />}
      Sync DLT-approved to MSG91
    </Button>
  );
}

export function Msg91SyncCell({ t }: { t: TemplateRow }) {
  const qc = useQueryClient();
  const allowed = useCanSync();
  const [open, setOpen] = useState(false);
  const status = msg91StatusLabel(t.msg91_sync_status);
  const blocker = msg91RegisterBlocker(t);
  const sync = useMutation({
    mutationFn: () => callMsg91({ action: t.msg91_template_id ? 'add_version' : 'register', template_id: t.id }),
    onSuccess: () => { toast.success(`"${t.name}" synced to MSG91`); qc.invalidateQueries({ queryKey: ['communication-templates'] }); },
    onError: (e: Error) => { toast.error(e.message); qc.invalidateQueries({ queryKey: ['communication-templates'] }); },
  });
  const action = t.msg91_template_id ? 'Resync' : 'Register';
  return (
    <div className="space-y-1">
      <Badge variant="outline" className={`rounded-full text-[10px] ${TONE[status.tone]}`}>{status.label}</Badge>
      {t.msg91_template_id && <p className="text-[10px] font-mono text-muted-foreground truncate max-w-[160px]">{t.msg91_template_id}</p>}
      {t.msg91_sync_status === 'failed' && t.msg91_sync_error && (
        <p className="text-[10px] text-destructive truncate max-w-[180px]" title={t.msg91_sync_error}>{t.msg91_sync_error}</p>
      )}
      {allowed && (
        <div className="flex gap-1">
          {t.msg91_sync_status !== 'synced' && (
            <Button
              type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]"
              disabled={!!blocker || sync.isPending} title={blocker || `${action} in MSG91`}
              aria-label={`${action} ${t.name} in MSG91`} onClick={() => sync.mutate()}
            >
              {sync.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3 w-3 mr-1" aria-hidden="true" />}
              {action}
            </Button>
          )}
          {t.msg91_template_id && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11px]" aria-label={`MSG91 versions for ${t.name}`} onClick={() => setOpen(true)}>
              <History className="h-3 w-3 mr-1" aria-hidden="true" /> Versions
            </Button>
          )}
        </div>
      )}
      {open && <VersionsSheet t={t} open={open} onOpenChange={setOpen} />}
    </div>
  );
}

function VersionsSheet({ t, open, onOpenChange }: { t: TemplateRow; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['msg91-versions', t.id],
    queryFn: async () => (await callMsg91({ action: 'versions', template_id: t.id })).versions ?? [],
  });
  const mark = useMutation({
    mutationFn: (versionId: string) => callMsg91({ action: 'mark_default', template_id: t.id, version_id: versionId }),
    onSuccess: () => {
      toast.success('Default version changed — resync before sending');
      qc.invalidateQueries({ queryKey: ['msg91-versions', t.id] });
      qc.invalidateQueries({ queryKey: ['communication-templates'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="p-6 border-b border-border">
          <SheetTitle>MSG91 versions — {t.name}</SheetTitle>
          <SheetDescription>Template {t.msg91_template_id}. Changing the default needs a resync before sending.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-3" aria-live="polite">
          {q.isLoading && [...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          {q.isError && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
          {q.data && q.data.length === 0 && <p className="text-sm text-muted-foreground">No versions returned by MSG91.</p>}
          {q.data?.map((v, i) => {
            const id = String(v.id ?? i);
            const active = v.is_active === true || v.is_active === 1;
            return (
              <div key={id} className="rounded-xl border border-border p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-muted-foreground">Version {id}</span>
                  {active
                    ? <Badge variant="outline" className={`rounded-full text-[10px] ${TONE.success}`}><CheckCircle className="h-3 w-3 mr-1" aria-hidden="true" />Default</Badge>
                    : <Button type="button" size="sm" variant="outline" className="h-8" disabled={mark.isPending} onClick={() => mark.mutate(id)}>Mark default</Button>}
                </div>
                {v.template && <p className="text-xs text-foreground whitespace-pre-wrap break-words">{v.template}</p>}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
