import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Activity, AlertTriangle, CheckCircle, Copy, Sparkles, Clock, Eye, Monitor, Server, Database, Zap, Trash2, CheckCheck, Download, RotateCcw, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { exportToCSV } from '@/lib/csvExport';
import { CommunicationFunnelCard } from '@/components/system/CommunicationFunnelCard';
import { ReconciliationFindingsCard } from '@/components/system/ReconciliationFindingsCard';
import { WhatsAppDeliveryHealthCard } from '@/components/system/WhatsAppDeliveryHealthCard';
import { PolicyAuditCard } from '@/components/system/PolicyAuditCard';
import { SystemAuditTab } from '@/components/system/SystemAuditTab';


interface ErrorLog {
  id: string;
  user_id: string | null;
  error_message: string;
  stack_trace: string | null;
  component_name: string | null;
  function_name: string | null;
  table_name: string | null;
  route: string | null;
  browser_info: string | null;
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  source?: string;
  severity?: string;
  fingerprint?: string | null;
  occurrence_count?: number;
  first_seen?: string | null;
  last_seen?: string | null;
  branch_id?: string | null;
  context?: any;
}

const SOURCE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  frontend: { label: 'Frontend', icon: Monitor, color: 'text-sky-600' },
  edge_function: { label: 'Backend Function', icon: Server, color: 'text-violet-600' },
  database: { label: 'Database', icon: Database, color: 'text-amber-600' },
  trigger: { label: 'Trigger', icon: Zap, color: 'text-emerald-600' },
  automation_brain: { label: 'Automation Brain', icon: Zap, color: 'text-indigo-600' },
  cron: { label: 'Cron Job', icon: Clock, color: 'text-orange-600' },
  worker: { label: 'Worker', icon: Server, color: 'text-teal-600' },
};

const FALLBACK_SOURCE = { label: 'Other', icon: Layers, color: 'text-slate-500' } as const;
const getSourceConfig = (s?: string | null) => SOURCE_CONFIG[s || 'frontend'] || FALLBACK_SOURCE;

const EMPTY_TABLE_CANDIDATES = [
  { name: 'role_permissions', note: 'Superseded by user_roles + has_role()' },
  { name: 'permissions', note: 'Superseded by user_roles' },
  { name: 'settings', note: 'Superseded by organization_settings' },
  { name: 'payment_transactions', note: 'Superseded by payments table' },
  { name: 'payroll_rules', note: 'Never used' },
  { name: 'biometric_sync_queue', note: 'Never used' },
  { name: 'device_commands', note: 'Never used' },
];

function DatabaseAuditCard() {
  const { data: tableCounts = [], isLoading } = useQuery({
    queryKey: ['db-audit-empty-tables'],
    queryFn: async () => {
      const results = await Promise.all(
        EMPTY_TABLE_CANDIDATES.map(async (t) => {
          try {
            const { count, error } = await (supabase.from(t.name as any) as any)
              .select('*', { count: 'exact', head: true });
            return { ...t, count: error ? -1 : (count ?? 0) };
          } catch {
            return { ...t, count: -1 };
          }
        })
      );
      return results;
    },
    staleTime: 60000,
  });

  const emptyTables = tableCounts.filter((t) => t.count === 0);

  return (
    <Card className="rounded-2xl border-border/50 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Database className="h-5 w-5 text-amber-600" />
          Database Audit — Empty/Unused Tables
          {emptyTables.length > 0 && (
            <Badge variant="secondary" className="text-xs">{emptyTables.length} empty</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Checking tables...</p>
        ) : emptyTables.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle className="h-10 w-10 text-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">All candidate tables have data. No cleanup needed.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table Name</TableHead>
                <TableHead>Rows</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emptyTables.map((t) => (
                <TableRow key={t.name}>
                  <TableCell className="font-mono text-sm">{t.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">0 rows</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground mt-3">
          These tables are empty and may be safe to remove. Review before deleting — some may be used by future features.
        </p>
      </CardContent>
    </Card>
  );
}

export default function SystemHealth() {
  const [selectedError, setSelectedError] = useState<ErrorLog | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [statusTab, setStatusTab] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [clearResolvedDialog, setClearResolvedDialog] = useState(false);
  const [resolveAllDialog, setResolveAllDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data: errors = [], isLoading } = useQuery({
    queryKey: ['error-logs', statusTab, sourceFilter],
    queryFn: async () => {
      let query = (supabase.from('error_logs') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (statusTab === 'open') query = query.eq('status', 'open');
      if (statusTab === 'resolved') query = query.eq('status', 'resolved');
      if (sourceFilter !== 'all') query = query.eq('source', sourceFilter);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as ErrorLog[];
    },
  });

  // Live updates: subscribe to error_logs changes so new edge errors stream in.
  useEffect(() => {
    const channel = supabase
      .channel('error-logs-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'error_logs' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['error-logs'] });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  const resolveError = useMutation({
    mutationFn: async (id: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase.from('error_logs') as any)
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: user?.id })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-logs'] });
      toast.success('Error marked as resolved');
      setDrawerOpen(false);
    },
  });

  const clearResolvedMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from('error_logs') as any)
        .delete()
        .eq('status', 'resolved');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-logs'] });
      toast.success('All resolved errors cleared');
      setClearResolvedDialog(false);
    },
    onError: () => toast.error('Failed to clear resolved errors'),
  });

  const resolveAllMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await (supabase.from('error_logs') as any)
        .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: user?.id })
        .eq('status', 'open');
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-logs'] });
      toast.success('All open errors marked as resolved');
      setResolveAllDialog(false);
    },
    onError: () => toast.error('Failed to resolve errors'),
  });

  const reopenError = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('error_logs') as any)
        .update({ status: 'open', resolved_at: null, resolved_by: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-logs'] });
      toast.success('Error reopened');
    },
  });

  const clearOldResolvedMutation = useMutation({
    mutationFn: async () => {
      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await (supabase.from('error_logs') as any)
        .delete()
        .eq('status', 'resolved')
        .lt('resolved_at', cutoff);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['error-logs'] });
      toast.success('Cleared resolved errors older than 90 days');
    },
  });

  const handleExport = () => {
    if (errors.length === 0) { toast.error('Nothing to export'); return; }
    exportToCSV(
      errors.map((e) => ({
        time: e.created_at,
        last_seen: e.last_seen || e.created_at,
        occurrences: e.occurrence_count ?? 1,
        severity: e.severity || 'error',
        source: e.source || 'frontend',
        function_name: e.function_name || '',
        route: e.route || '',
        message: e.error_message,
        status: e.status,
        fingerprint: e.fingerprint || '',
      })),
      `error-logs-${new Date().toISOString().split('T')[0]}.csv`,
    );
    toast.success('Exported error logs');
  };

  const openErrors = errors.filter((e) => e.status === 'open');
  const resolvedErrors = errors.filter((e) => e.status === 'resolved');
  const todayErrors = errors.filter((e) => new Date(e.created_at).toDateString() === new Date().toDateString());
  const frontendErrors = errors.filter((e) => (e.source || 'frontend') === 'frontend');
  const backendErrors = errors.filter((e) => e.source && e.source !== 'frontend');

  const handleViewError = (err: ErrorLog) => {
    setSelectedError(err);
    setGeneratedPrompt('');
    setDrawerOpen(true);
  };

  const generatePrompt = (err: ErrorLog) => {
    const source = err.source || 'frontend';
    const prompt = `I have an error in my ${source === 'frontend' ? 'React application' : source === 'edge_function' ? 'backend function' : 'database'}. ${source === 'frontend' ? `The component crashed at route: ${err.route || 'unknown'}.` : ''} The error message is: ${err.error_message}. Here is the stack trace: ${err.stack_trace || 'N/A'}. Please audit the relevant code and provide a fix.`;
    setGeneratedPrompt(prompt);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedPrompt);
    toast.success('Prompt copied to clipboard');
  };

  const criticalOpen = openErrors.filter((e) => (e.severity || 'error') === 'critical').length;
  const totalOccurrences = errors.reduce((sum, e) => sum + (e.occurrence_count ?? 1), 0);

  const stats = [
    { label: 'Open Errors', value: openErrors.length, icon: AlertTriangle, color: 'text-destructive' },
    { label: 'Critical Open', value: criticalOpen, icon: Zap, color: 'text-rose-600' },
    { label: 'Today', value: todayErrors.length, icon: Clock, color: 'text-amber-600' },
    { label: 'Total Occurrences', value: totalOccurrences, icon: Layers, color: 'text-violet-600' },
    { label: 'Frontend', value: frontendErrors.length, icon: Monitor, color: 'text-sky-600' },
    { label: 'Backend', value: backendErrors.length, icon: Server, color: 'text-emerald-600' },
  ];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-600 to-pink-600 text-white">
                <Activity className="h-6 w-6" />
              </div>
              System Health
            </h1>
            <p className="text-muted-foreground mt-1">Monitor errors across frontend, backend functions, and database</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={handleExport}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            {openErrors.length > 0 && (
              <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => setResolveAllDialog(true)}>
                <CheckCheck className="h-4 w-4" />
                Resolve All Open
              </Button>
            )}
            {resolvedErrors.length > 0 && (
              <>
                <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={() => clearOldResolvedMutation.mutate()} disabled={clearOldResolvedMutation.isPending}>
                  <Trash2 className="h-4 w-4" /> Clear &gt; 90 days
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl gap-1.5 text-destructive hover:text-destructive" onClick={() => setClearResolvedDialog(true)}>
                  <Trash2 className="h-4 w-4" />
                  Clear Resolved
                </Button>
              </>
            )}
          </div>
        </div>


        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="rounded-xl">
            <TabsTrigger value="overview" className="rounded-lg">Overview</TabsTrigger>
            <TabsTrigger value="errors" className="rounded-lg">Errors</TabsTrigger>
            <TabsTrigger value="audit" className="rounded-lg">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {stats.map((s) => (
                <Card key={s.label} className="rounded-2xl border-border/50 shadow-lg shadow-slate-200/50">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className={`p-2 rounded-xl bg-muted ${s.color}`}>
                      <s.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <CommunicationFunnelCard />

            <div className="grid gap-4 md:grid-cols-2">
              <ReconciliationFindingsCard />
              <WhatsAppDeliveryHealthCard />
            </div>

            <PolicyAuditCard />
          </TabsContent>

          <TabsContent value="errors" className="space-y-6 mt-4">
            <Card className="rounded-2xl border-border/50 shadow-lg">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <CardTitle className="text-lg">Error Logs</CardTitle>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger className="w-[180px] rounded-xl">
                      <SelectValue placeholder="Filter by source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Sources</SelectItem>
                      <SelectItem value="frontend">Frontend</SelectItem>
                      <SelectItem value="edge_function">Backend Functions</SelectItem>
                      <SelectItem value="database">Database</SelectItem>
                      <SelectItem value="trigger">Triggers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={statusTab} onValueChange={setStatusTab}>
                  <TabsList className="mb-4 rounded-xl">
                    <TabsTrigger value="all" className="rounded-lg">All ({errors.length})</TabsTrigger>
                    <TabsTrigger value="open" className="rounded-lg">Open ({openErrors.length})</TabsTrigger>
                    <TabsTrigger value="resolved" className="rounded-lg">Resolved ({resolvedErrors.length})</TabsTrigger>
                  </TabsList>

                  <TabsContent value={statusTab}>
                    {isLoading ? (
                      <p className="text-muted-foreground text-sm py-8 text-center">Loading...</p>
                    ) : errors.length === 0 ? (
                      <div className="text-center py-12">
                        <CheckCircle className="h-12 w-12 text-primary mx-auto mb-3" />
                        <p className="text-muted-foreground">No errors found. System is healthy!</p>
                      </div>
                    ) : (
                      <div className="overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Last Seen</TableHead>
                              <TableHead>Severity</TableHead>
                              <TableHead>Source</TableHead>
                              <TableHead>Function / Route</TableHead>
                              <TableHead>Message</TableHead>
                              <TableHead className="text-right">Count</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {errors.map((err) => {
                              const src = getSourceConfig(err.source);
                              const sev = (err.severity || 'error').toLowerCase();
                              const sevBadgeClass =
                                sev === 'critical' ? 'bg-rose-100 text-rose-700' :
                                sev === 'error' ? 'bg-red-100 text-red-700' :
                                sev === 'warning' ? 'bg-amber-100 text-amber-700' :
                                'bg-slate-100 text-slate-700';
                              const lastTime = err.last_seen || err.created_at;
                              return (
                                <TableRow key={err.id}>
                                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    {format(new Date(lastTime), 'MMM d, HH:mm')}
                                  </TableCell>
                                  <TableCell>
                                    <Badge className={`${sevBadgeClass} rounded-full text-xs font-medium`} variant="secondary">{sev}</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="gap-1 text-xs">
                                      <src.icon className={`h-3 w-3 ${src.color}`} />
                                      {src.label}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="font-mono text-xs max-w-[180px] truncate">{err.function_name || err.route || '—'}</TableCell>
                                  <TableCell className="max-w-[280px] truncate text-sm">{err.error_message}</TableCell>
                                  <TableCell className="text-right text-xs font-semibold">{err.occurrence_count ?? 1}</TableCell>
                                  <TableCell>
                                    <Badge variant={err.status === 'open' ? 'destructive' : 'secondary'}>{err.status}</Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                      {err.status === 'resolved' && (
                                        <Button size="sm" variant="ghost" onClick={() => reopenError.mutate(err.id)} title="Reopen">
                                          <RotateCcw className="h-4 w-4" />
                                        </Button>
                                      )}
                                      <Button size="sm" variant="ghost" onClick={() => handleViewError(err)}>
                                        <Eye className="h-4 w-4 mr-1" /> View
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Database Audit: Empty/Unused Tables */}
            <DatabaseAuditCard />
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <SystemAuditTab />
          </TabsContent>
        </Tabs>
      </div>

      {/* Clear Resolved Confirmation */}
      <AlertDialog open={clearResolvedDialog} onOpenChange={setClearResolvedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Resolved Errors?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {resolvedErrors.length} resolved error log(s). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => clearResolvedMutation.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {clearResolvedMutation.isPending ? 'Clearing...' : 'Clear All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Resolve All Open Confirmation */}
      <AlertDialog open={resolveAllDialog} onOpenChange={setResolveAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve All Open Errors?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark {openErrors.length} open error(s) as resolved. You can clear them afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resolveAllMutation.mutate()}>
              {resolveAllMutation.isPending ? 'Resolving...' : 'Resolve All'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Error Details
            </SheetTitle>
          </SheetHeader>

          {selectedError && (
            <div className="space-y-4 mt-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Error Message</p>
                <p className="text-sm text-foreground bg-muted p-3 rounded-lg">{selectedError.error_message}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Source</p>
                  <Badge variant="outline" className="gap-1">
                    {(() => { const s = getSourceConfig(selectedError.source); return <><s.icon className={`h-3 w-3 ${s.color}`} />{s.label}</>; })()}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Status</p>
                  <Badge variant={selectedError.status === 'open' ? 'destructive' : 'secondary'}>{selectedError.status}</Badge>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Route</p>
                  <p className="text-sm font-mono">{selectedError.route || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Time</p>
                  <p className="text-sm">{format(new Date(selectedError.created_at), 'PPpp')}</p>
                </div>
              </div>

              {selectedError.stack_trace && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Stack Trace</p>
                  <pre className="text-xs bg-muted p-3 rounded-lg overflow-auto max-h-48 whitespace-pre-wrap">{selectedError.stack_trace}</pre>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                {selectedError.status === 'open' && (
                  <Button variant="outline" onClick={() => resolveError.mutate(selectedError.id)} disabled={resolveError.isPending}>
                    <CheckCircle className="h-4 w-4 mr-1" /> Mark Resolved
                  </Button>
                )}
                <Button onClick={() => generatePrompt(selectedError)}>
                  <Sparkles className="h-4 w-4 mr-1" /> Generate AI Fix Prompt
                </Button>
              </div>

              {generatedPrompt && (
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-medium text-muted-foreground">AI Fix Prompt</p>
                  <Textarea value={generatedPrompt} readOnly className="min-h-[120px] text-sm font-mono" />
                  <Button variant="outline" size="sm" onClick={copyToClipboard}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppLayout>
  );
}
