import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranchContext } from '@/contexts/BranchContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { RefreshCw, CheckCircle, Settings2, AlertTriangle, Trash2, Archive } from 'lucide-react';


/**
 * Compact inline replacement for the standalone "Meta Approved" tab.
 * Renders just the two actions (Test Connection · Sync from Meta) plus a small
 * diagnostics popover, intended to live next to the status-filter chips on the
 * CRM Templates view.
 */
export function MetaSyncControls() {
  const queryClient = useQueryClient();
  const { selectedBranch, effectiveBranchId } = useBranchContext();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number | null>(null);
  const [lastSummary, setLastSummary] = useState<{ imported: number; updated: number; stale: number } | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations', 'whatsapp', selectedBranch],
    queryFn: async () => {
      let q = supabase
        .from('integration_settings')
        .select('id, branch_id, config')
        .eq('integration_type', 'whatsapp')
        .eq('is_active', true);
      if (selectedBranch !== 'all') {
        q = q.or(`branch_id.eq.${selectedBranch},branch_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  // Templates flagged as missing in Meta (auto-marked by send-whatsapp on error 132001)
  const { data: staleTemplates = [] } = useQuery({
    queryKey: ['whatsapp-templates-stale', selectedBranch],
    queryFn: async () => {
      let q = supabase
        .from('whatsapp_templates')
        .select('id, name, meta_last_error')
        .eq('is_stale', true);
      if (selectedBranch !== 'all') {
        q = q.or(`branch_id.eq.${selectedBranch},branch_id.is.null`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 60_000,
  });

  // CRM-side templates — used to tell orphaned mirror rows apart from ones that
  // an active CRM template still points at (those actually break sends).
  const { data: crmTemplateNames = [] } = useQuery({
    queryKey: ['crm-template-meta-names'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('templates')
        .select('id, name, meta_template_name')
        .not('meta_template_name', 'is', null);
      if (error) throw error;
      return data || [];
    },
  });

  const crmByMetaName = new Map<string, { id: string; name: string }>();
  for (const row of crmTemplateNames as any[]) {
    if (row.meta_template_name) crmByMetaName.set(row.meta_template_name, { id: row.id, name: row.name });
  }
  const brokenStale = (staleTemplates as any[]).filter((t) => crmByMetaName.has(t.name));
  const orphanStale = (staleTemplates as any[]).filter((t) => !crmByMetaName.has(t.name));

  const [confirmPurge, setConfirmPurge] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  const handlePurgeOrphans = async () => {
    setIsPurging(true);
    try {
      const ids = orphanStale.map((t) => t.id);
      const { error } = await supabase.from('whatsapp_templates').delete().in('id', ids);
      if (error) throw error;
      toast.success(`Cleared ${ids.length} orphaned catalog entr${ids.length === 1 ? 'y' : 'ies'}`);
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates-stale'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates-live-alignment'] });
      queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
      queryClient.invalidateQueries({ queryKey: ['template-coverage-gaps'] });
      setConfirmPurge(false);
    } catch (err: any) {
      toast.error(err.message || 'Could not clear orphaned entries');
    } finally {
      setIsPurging(false);
    }
  };

  const hasConfig = integrations.length > 0;
  const branchForCall = effectiveBranchId;
  const disabled = !hasConfig || !branchForCall;


  const handleTest = async () => {
    if (!branchForCall) return toast.error('No branch available');
    setIsTesting(true);
    setLastError(null);
    try {
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: { action: 'list', branch_id: branchForCall },
      });
      if (error) throw error;
      if (data?.error) {
        const errStr = String(data.error);
        if (errStr.includes('does not exist') || errStr.includes('cannot be loaded')) {
          throw new Error('WABA ID not found. Verify it in Settings → Integrations.');
        }
        throw new Error(errStr);
      }
      const count = data?.templates?.length || 0;
      toast.success(`Connection OK — ${count} template(s) registered with Meta.`);
    } catch (err: any) {
      setLastError(err.message);
      toast.error(`Connection failed: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSync = async () => {
    if (!branchForCall) return toast.error('No branch available');
    setIsSyncing(true);
    setLastError(null);
    try {
      const { data, error } = await supabase.functions.invoke('manage-whatsapp-templates', {
        body: { action: 'list', branch_id: branchForCall },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const count = data?.templates?.length || 0;
      const summary = data?.reconciliation;
      setLastCount(count);
      setLastSummary(summary ? {
        imported: Number(summary.imported) || 0,
        updated: Number(summary.updated) || 0,
        stale: Number(summary.stale) || 0,
      } : null);
      setLastSynced(new Date().toLocaleTimeString());
      toast.success(summary
        ? `Reconciled ${count}: ${summary.imported} imported, ${summary.updated} updated, ${summary.stale} stale`
        : `Synced ${count} template(s) from Meta`);
      queryClient.invalidateQueries({ queryKey: ['communication-templates'] });
      queryClient.invalidateQueries({ queryKey: ['template-coverage'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates-stale'] });
    } catch (err: any) {
      setLastError(err.message);
      toast.error(err.message || 'Sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 ml-auto">
      {staleTemplates.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={`h-7 gap-1 rounded-full text-xs ${
                brokenStale.length > 0
                  ? 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15'
                  : 'border-slate-200 text-muted-foreground hover:bg-slate-50'
              }`}
              aria-label={
                brokenStale.length > 0
                  ? `${brokenStale.length} template(s) broken in Meta`
                  : `${orphanStale.length} orphaned Meta catalog entries`
              }
            >
              {brokenStale.length > 0 ? (
                <>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {brokenStale.length} broken in Meta
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5" />
                  {orphanStale.length} stale entries
                </>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 text-xs space-y-3">
            {brokenStale.length > 0 && (
              <div className="space-y-2">
                <div className="font-semibold text-sm flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="h-4 w-4" /> Broken — sends will fail
                </div>
                <p className="text-muted-foreground">
                  A CRM template still points at these Meta templates, but Meta no longer has them
                  (error 132001). Open the template below and re-submit it to Meta.
                </p>
                <ul className="max-h-40 overflow-y-auto space-y-1 border-t pt-2">
                  {brokenStale.map((t) => (
                    <li key={t.id} className="rounded-md bg-warning/10 p-1.5">
                      <div className="font-medium text-warning">{t.name}</div>
                      <div className="text-[10px] text-warning/80">
                        Used by CRM template “{crmByMetaName.get(t.name)?.name}”
                      </div>
                      {t.meta_last_error && (
                        <div className="text-[10px] text-warning truncate" title={t.meta_last_error}>
                          {t.meta_last_error}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {orphanStale.length > 0 && (
              <div className="space-y-2">
                <div className="font-semibold text-sm flex items-center gap-1.5 text-muted-foreground">
                  <Archive className="h-4 w-4" /> Orphaned catalog entries ({orphanStale.length})
                </div>
                <p className="text-muted-foreground">
                  Leftovers from an older Meta catalog. No CRM template uses them, so nothing breaks —
                  clearing them only tidies this local mirror. Meta is not touched.
                </p>
                <ul className="max-h-36 overflow-y-auto space-y-1 border-t pt-2">
                  {orphanStale.map((t) => (
                    <li key={t.id} className="rounded-md bg-muted/50 p-1.5 text-muted-foreground">
                      {t.name}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmPurge(true)}
                  className="w-full h-8 gap-1.5 rounded-xl text-xs"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear orphaned entries
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}

      <AlertDialog open={confirmPurge} onOpenChange={setConfirmPurge}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear {orphanStale.length} orphaned entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {orphanStale.length} stale row(s) from the local Meta catalog mirror. No CRM
              template points at them and nothing is deleted inside Meta. Re-syncing from Meta will
              bring back anything that still exists there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-xl bg-muted/40 p-3 text-xs space-y-1">
            {orphanStale.map((t) => (
              <div key={t.id} className="text-muted-foreground">{t.name}</div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPurging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handlePurgeOrphans();
              }}
              disabled={isPurging}
            >
              {isPurging ? 'Clearing…' : `Clear ${orphanStale.length}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {lastSynced && (
        <span className="text-[11px] text-muted-foreground hidden md:inline">
          Last synced {lastSynced}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={handleTest}
        disabled={disabled || isTesting}
        className="h-7 gap-1 rounded-full text-xs"
        aria-label="Test Meta connection"
      >
        <CheckCircle className={`h-3.5 w-3.5 ${isTesting ? 'animate-pulse' : ''}`} />
        {isTesting ? 'Testing…' : 'Test'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={disabled || isSyncing}
        className="h-7 gap-1 rounded-full text-xs"
        data-testid="btn-sync-meta-templates"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
        {isSyncing ? 'Syncing…' : 'Sync from Meta'}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            aria-label="Meta connection details"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 text-xs space-y-2">
          <div className="font-semibold text-sm">Meta connection</div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">WhatsApp integrations</span>
            <span className="font-medium">{integrations.length}</span>
          </div>
          {lastSynced && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last sync</span>
              <span className="font-medium">{lastSynced}</span>
            </div>
          )}
          {lastCount !== null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Registered with Meta</span>
              <span className="font-medium">{lastCount}</span>
            </div>
          )}
          {lastSummary && (
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-center">
              <div><div className="font-semibold">{lastSummary.imported}</div><div className="text-[10px] text-muted-foreground">Imported</div></div>
              <div><div className="font-semibold">{lastSummary.updated}</div><div className="text-[10px] text-muted-foreground">Updated</div></div>
              <div><div className="font-semibold text-warning">{lastSummary.stale}</div><div className="text-[10px] text-muted-foreground">Stale</div></div>
            </div>
          )}
          {lastError && (
            <div className="rounded-md bg-destructive/10 p-2 text-destructive">
              {lastError}
            </div>
          )}
          {!hasConfig && (
            <div className="rounded-md bg-warning/10 p-2 text-warning">
              No WhatsApp integration configured. Add one in Settings → Integrations.
            </div>
          )}
          <p className="text-[11px] text-muted-foreground pt-1 border-t">
            Template deletion must be done in Meta Business Manager.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
