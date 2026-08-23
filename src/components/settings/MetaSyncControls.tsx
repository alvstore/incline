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
              className="h-7 gap-1 rounded-full text-xs border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
              aria-label={`${staleTemplates.length} template(s) missing in Meta`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {staleTemplates.length} missing in Meta
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-xs space-y-2">
            <div className="font-semibold text-sm flex items-center gap-1.5 text-warning">
              <AlertTriangle className="h-4 w-4" /> Templates missing in Meta
            </div>
            <p className="text-muted-foreground">
              These templates were rejected by Meta (error 132001). Re-sync from Meta to refresh, or
              recreate them in Meta Business Manager.
            </p>
            <ul className="max-h-48 overflow-y-auto space-y-1 border-t pt-2">
              {staleTemplates.map((t) => (
                <li key={t.id} className="rounded-md bg-warning/10 p-1.5">
                  <div className="font-medium text-warning">{t.name}</div>
                  {t.meta_last_error && (
                    <div className="text-[10px] text-warning truncate" title={t.meta_last_error}>
                      {t.meta_last_error}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
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
