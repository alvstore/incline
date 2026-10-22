import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, AlertTriangle, TrendingUp, Database, Route as RouteIcon, RefreshCw, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

type Fingerprint = {
  fingerprint: string;
  error_message: string;
  source: string | null;
  severity: string | null;
  function_name: string | null;
  route: string | null;
  total_occurrences: number;
  open_count: number;
  first_seen: string;
  last_seen: string;
};

type Breakdown = { source: string; severity: string; total: number; open_count: number };
type Trend = { day: string; total: number; critical_count: number };
type TopRoute = { route: string; total: number; open_count: number };
type RlsRow = { table_name: string; rls_enabled: boolean; policy_count: number };

const sevClass = (s: string) =>
  s === 'critical' ? 'bg-destructive/15 text-destructive' :
  s === 'error' ? 'bg-destructive/15 text-destructive' :
  s === 'warning' ? 'bg-warning/15 text-warning' :
  'bg-muted text-foreground';

export function SystemAuditTab() {
  const [days, setDays] = useState('7');
  const numDays = Number(days);
  const [view, setView] = useState('open');
  const [confirmClear, setConfirmClear] = useState(false);
  const queryClient = useQueryClient();
  const resolve = useMutation({
    mutationFn: async (fingerprint: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in again');
      const { error } = await supabase.from('error_logs').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: user.id }).eq('fingerprint', fingerprint).eq('status', 'open');
      if (error) throw error;
    },
    onSuccess: () => { refreshAll(); queryClient.invalidateQueries({ queryKey: ['error-logs'] }); toast.success('Error group resolved'); },
    onError: () => toast.error('Could not resolve this group'),
  });
  const clear = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('error_logs').delete().eq('status', 'resolved');
      if (error) throw error;
    },
    onSuccess: () => { setConfirmClear(false); refreshAll(); queryClient.invalidateQueries({ queryKey: ['error-logs'] }); toast.success('Resolved error logs cleared'); },
    onError: () => toast.error('Could not clear resolved logs'),
  });

  const fp = useQuery({
    queryKey: ['audit-fingerprints', numDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_error_audit_top_fingerprints', { _days: numDays, _limit: 1000 });
      if (error) throw error;
      return (data || []) as Fingerprint[];
    },
  });

  const breakdown = useQuery({
    queryKey: ['audit-breakdown', numDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_error_audit_breakdown', { _days: numDays });
      if (error) throw error;
      return (data || []) as Breakdown[];
    },
  });

  const trend = useQuery({
    queryKey: ['audit-trend', numDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_error_audit_daily_trend', { _days: numDays });
      if (error) throw error;
      return (data || []) as Trend[];
    },
  });

  const routes = useQuery({
    queryKey: ['audit-routes', numDays],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_error_audit_top_routes', { _days: numDays, _limit: 10 });
      if (error) throw error;
      return (data || []) as TopRoute[];
    },
  });

  const rls = useQuery({
    queryKey: ['audit-rls'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_db_audit_rls_status');
      if (error) throw error;
      return (data || []) as RlsRow[];
    },
  });

  const refreshAll = () => {
    fp.refetch(); breakdown.refetch(); trend.refetch(); routes.refetch(); rls.refetch();
  };

  const maxTrend = Math.max(1, ...(trend.data?.map((t) => Number(t.total)) || [1]));
  const visibleFingerprints = (fp.data || []).filter((f) => view === 'all' || (view === 'open' ? f.open_count > 0 && f.severity !== 'info' : f.open_count === 0));
  const queryFailed = fp.isError || breakdown.isError || trend.isError || routes.isError || rls.isError;
  const rlsIssues = (rls.data || []).filter((r) => !r.rls_enabled);
  const lockedTables = (rls.data || []).filter((r) => r.rls_enabled && r.policy_count === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Audit Insights</h2>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <Select value={view} onValueChange={setView}><SelectTrigger className="w-[170px]" aria-label="Audit status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open errors</SelectItem><SelectItem value="resolved">Resolved history</SelectItem><SelectItem value="all">All activity</SelectItem></SelectContent></Select>
          <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)} disabled={clear.isPending}>Clear resolved</Button>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-[140px] rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 hours</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      {queryFailed && <div role="alert" className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">Some audit reports could not load. <Button variant="outline" size="sm" onClick={refreshAll}>Retry</Button></div>}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Clear resolved error logs?</AlertDialogTitle><AlertDialogDescription>This permanently removes resolved error logs across all dates. Open errors and transaction audit history are kept.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); clear.mutate(); }} disabled={clear.isPending}>{clear.isPending ? 'Clearing…' : 'Clear resolved logs'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      {/* Daily Trend */}
      <Card className="rounded-2xl border-border/50 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-info" /> Daily Activity Trend (last {days} days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trend.isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : trend.isError ? (<p className="text-sm text-destructive">Activity report unavailable.</p>) : !trend.data?.length ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No errors in this window.</p>
            </div>
          ) : (
            <div className="flex items-end gap-1.5 h-32">
              {trend.data.map((d) => {
                const h = (Number(d.total) / maxTrend) * 100;
                const crit = Number(d.critical_count) > 0;
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.total} (${d.critical_count} critical)`}>
                    <div
                      className={`w-full rounded-t-md transition-all ${crit ? 'bg-destructive' : 'bg-info'}`}
                      style={{ height: `${Math.max(h, 4)}%` }}
                    />
                    <span className="text-[10px] text-muted-foreground">{format(new Date(d.day), 'd/M')}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Fingerprints */}
      <Card className="rounded-2xl border-border/50 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Error Groups
            <Badge variant="secondary" className="text-xs ml-1">last {days}d</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fp.isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : fp.isError ? (<p className="text-sm text-destructive">Error groups unavailable.</p>) : !visibleFingerprints.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{view === 'open' ? 'No open errors in this window.' : 'No matching activity.'}</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severity</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Function / Route</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="text-right">Occurrences</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead>Last Seen</TableHead><TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleFingerprints.map((f) => (
                    <TableRow key={f.fingerprint}>
                      <TableCell>
                        <Badge className={`${sevClass((f.severity || 'error').toLowerCase())} rounded-full text-xs font-medium`} variant="secondary">
                          {f.severity || 'error'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{f.source || 'frontend'}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[180px] truncate">{f.function_name || f.route || '—'}</TableCell>
                      <TableCell title={f.error_message} className="max-w-[320px] truncate text-sm">{f.error_message}</TableCell>
                      <TableCell className="text-right font-semibold">{f.total_occurrences}</TableCell>
                      <TableCell className="text-right">
                        {Number(f.open_count) > 0 ? (
                          <Badge variant="destructive" className="text-xs">{f.open_count}</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">0</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(f.last_seen), 'MMM d, HH:mm')}
                      </TableCell><TableCell>{f.open_count > 0 ? <Button size="sm" variant="outline" disabled={resolve.isPending} onClick={() => resolve.mutate(f.fingerprint)}>Resolve</Button> : <span className="text-xs text-success">Resolved</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Breakdown + Routes side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl border-border/50 shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Breakdown by Source &amp; Severity</CardTitle>
          </CardHeader>
          <CardContent>
            {breakdown.isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
            ) : breakdown.isError ? (<p className="text-sm text-destructive">Report unavailable.</p>) : !breakdown.data?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No data.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakdown.data.map((b, i) => (
                    <TableRow key={`${b.source}-${b.severity}-${i}`}>
                      <TableCell className="text-xs font-mono">{b.source}</TableCell>
                      <TableCell>
                        <Badge className={`${sevClass(b.severity)} rounded-full text-xs`} variant="secondary">{b.severity}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{b.total}</TableCell>
                      <TableCell className="text-right text-destructive">{b.open_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50 shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <RouteIcon className="h-4 w-4 text-primary" /> Top Noisy Frontend Routes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {routes.isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
            ) : routes.isError ? (<p className="text-sm text-destructive">Report unavailable.</p>) : !routes.data?.length ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No data.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Route</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routes.data.map((r, i) => (
                    <TableRow key={`${r.route}-${i}`}>
                      <TableCell className="font-mono text-xs max-w-[260px] truncate">{r.route}</TableCell>
                      <TableCell className="text-right font-semibold">{r.total}</TableCell>
                      <TableCell className="text-right text-destructive">{r.open_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* DB Linter Sweep */}
      <Card className="rounded-2xl border-border/50 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-warning" /> Database RLS Sweep
            {rlsIssues.length > 0 ? (
              <Badge variant="destructive" className="text-xs">{rlsIssues.length} require review</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">No unprotected tables</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rls.isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : rls.isError ? (<p className="text-sm text-destructive">Security report unavailable.</p>) : rlsIssues.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Row security is enabled on every checked table. {lockedTables.length} tables are locked to direct app access.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>RLS</TableHead>
                  <TableHead className="text-right">Policies</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rlsIssues.map((r) => (
                  <TableRow key={r.table_name}>
                    <TableCell className="font-mono text-xs">{r.table_name}</TableCell>
                    <TableCell>
                      <Badge variant={r.rls_enabled ? 'secondary' : 'destructive'} className="text-xs">
                        {r.rls_enabled ? 'enabled' : 'DISABLED'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{r.policy_count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {!r.rls_enabled ? 'Table is open to anyone with the key' : 'RLS on but no policies — table effectively locked'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Structural check only; enabled row security does not prove every access rule is correct.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
