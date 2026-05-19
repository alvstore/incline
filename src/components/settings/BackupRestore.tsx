import { useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Download, Upload, Database, ShieldAlert, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { DisasterRecoveryCard } from '@/components/system/DisasterRecoveryCard';

export function BackupRestore() {
  const { hasAnyRole } = useAuth();
  const isAdmin = hasAnyRole(['owner', 'admin']);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [conflict, setConflict] = useState<'skip' | 'overwrite'>('skip');
  const [lastSummary, setLastSummary] = useState<any>(null);

  if (!isAdmin) {
    return (
      <Alert variant="destructive" className="rounded-2xl">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Restricted</AlertTitle>
        <AlertDescription>Backup & Restore is available to owners and admins only.</AlertDescription>
      </Alert>
    );
  }

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/backup`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'export' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `incline-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
      toast.success('Backup exported successfully');
    } catch (e: any) {
      toast.error(e.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (file: File, dryRun: boolean) => {
    setImporting(true);
    setLastSummary(null);
    try {
      const text = await file.text();
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('Invalid JSON file');
      }
      if (!payload?.data || !payload?.meta) {
        throw new Error('File is not a valid Incline backup (missing meta/data)');
      }
      payload.dry_run = dryRun;
      payload.conflict_strategy = conflict;

      const { data, error } = await supabase.functions.invoke('backup', {
        body: { action: 'import', ...payload },
      });
      if (error) throw error;
      setLastSummary(data?.summary);
      toast.success(dryRun ? 'Dry-run complete — review summary' : 'Restore complete');
    } catch (e: any) {
      toast.error(e.message || 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onFileSelected = (dryRun: boolean) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleImport(file, dryRun);
  };

  return (
    <div className="space-y-6">
      <DisasterRecoveryCard />

      {/* Hero */}
      <Card className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-xl overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(255,255,255,0.15)_0%,_transparent_60%)]" />
        <CardContent className="p-6 relative z-10">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10">
              <Database className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Backup & Restore</h3>
              <p className="text-sm text-white/70">Full database JSON snapshots — owners & admins only</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Export */}
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5 text-indigo-600" /> Export full backup</CardTitle>
          <CardDescription>
            Download a complete JSON snapshot of every CRM table. Auth users and storage files are not included.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={exporting} className="gap-2">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? 'Preparing backup…' : 'Download backup'}
          </Button>
        </CardContent>
      </Card>

      {/* Import */}
      <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-emerald-600" /> Restore from backup</CardTitle>
          <CardDescription>
            Restore a previously exported JSON file. Run a dry-run first to preview changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive" className="rounded-xl">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Destructive action</AlertTitle>
            <AlertDescription>
              "Overwrite" will replace existing rows that share the same id. Use "Skip" to import only new rows.
            </AlertDescription>
          </Alert>

          <div>
            <Label className="text-sm font-medium">Conflict strategy</Label>
            <RadioGroup value={conflict} onValueChange={(v) => setConflict(v as any)} className="mt-2 grid grid-cols-2 gap-2">
              <Label htmlFor="skip" className="flex items-center gap-2 rounded-xl border p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem id="skip" value="skip" />
                <span className="text-sm">Skip duplicates (safe)</span>
              </Label>
              <Label htmlFor="overwrite" className="flex items-center gap-2 rounded-xl border p-3 cursor-pointer hover:bg-muted/50">
                <RadioGroupItem id="overwrite" value="overwrite" />
                <span className="text-sm">Overwrite existing</span>
              </Label>
            </RadioGroup>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={onFileSelected(false)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={importing}
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/json';
                input.onchange = (e: any) => {
                  const f = e.target.files?.[0];
                  if (f) handleImport(f, true);
                };
                input.click();
              }}
              className="gap-2"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Dry-run (preview)
            </Button>
            <Button
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Restore now
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {lastSummary && (
        <Card className="rounded-2xl shadow-lg shadow-slate-200/50">
          <CardHeader>
            <CardTitle>Restore summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {Object.entries(lastSummary).map(([table, stat]: any) => (
                <div key={table} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                  <span className="font-medium">{table}</span>
                  <div className="flex items-center gap-2">
                    {stat.inserted > 0 && <Badge variant="secondary" className="bg-emerald-100 text-emerald-700">+{stat.inserted}</Badge>}
                    {stat.updated > 0 && <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">~{stat.updated}</Badge>}
                    {stat.skipped > 0 && <Badge variant="outline">skipped {stat.skipped}</Badge>}
                    {stat.errors?.length > 0 && <Badge variant="destructive">{stat.errors.length} err</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
