import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, AlertTriangle, TrendingUp, Database, Route as RouteIcon, RefreshCw, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

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
  s === 'critical' ? 'bg-rose-100 text-rose-700' :
  s === 'error' ? 'bg-red-100 text-red-700' :
  s === 'warning' ? 'bg-amber-100 text-amber-700' :
  'bg-slate-100 text-slate-700';

export function SystemAuditTab() {
  const [days, setDays] = useState('7');
  const numDays = Number(days);

  const fp = useQuery({
    queryKey: ['audit-fingerprints', numDays],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_error_audit_top_fingerprints', { _days: numDays, _limit: 20 });
      if (error) throw error;
      return (data || []) as Fingerprint[];
    },
  });

  const breakdown = useQuery({
    queryKey: ['audit-breakdown', numDays],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_error_audit_breakdown', { _days: numDays });
      if (error) throw error;
      return (data || []) as Breakdown[];
    },
  });

  const trend = useQuery({
    queryKey: ['audit-trend'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_error_audit_daily_trend', { _days: 14 });
      if (error) throw error;
      return (data || []) as Trend[];
    },
  });

  const routes = useQuery({
    queryKey: ['audit-routes', numDays],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_error_audit_top_routes', { _days: numDays, _limit: 10 });
      if (error) throw error;
      return (data || []) as TopRoute[];
    },
  });

  const rls = useQuery({
    queryKey: ['audit-rls'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_db_audit_rls_status');
      if (error) throw error;
      return (data || []) as RlsRow[];
    },
  });

  const refreshAll = () => {
    fp.refetch(); breakdown.refetch(); trend.refetch(); routes.refetch(); rls.refetch();
  };

  const maxTrend = Math.max(1, ...(trend.data?.map((t) => Number(t.total)) || [1]));
  const rlsIssues = (rls.data || []).filter((r) => !r.rls_enabled || r.policy_count === 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-violet-600" />
          <h2 className="text-lg font-semibold">Audit Insights</h2>
        </div>
        <div className="flex items-center gap-2">
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

      {/* Daily Trend */}
      <Card className="rounded-2xl border-border/50 shadow-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-sky-600" /> Daily Error Trend (last 14 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trend.isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : !trend.data?.length ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
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
                      className={`w-full rounded-t-md transition-all ${crit ? 'bg-rose-500' : 'bg-sky-500'}`}
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
            <AlertTriangle className="h-4 w-4 text-rose-600" /> Top Recurring Errors
            <Badge variant="secondary" className="text-xs ml-1">last {days}d</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fp.isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : !fp.data?.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No recurring errors.</p>
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
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fp.data.map((f) => (
                    <TableRow key={f.fingerprint}>
                      <TableCell>
                        <Badge className={`${sevClass((f.severity || 'error').toLowerCase())} rounded-full text-xs font-medium`} variant="secondary">
                          {f.severity || 'error'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{f.source || 'frontend'}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[180px] truncate">{f.function_name || f.route || '—'}</TableCell>
                      <TableCell className="max-w-[320px] truncate text-sm">{f.error_message}</TableCell>
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
                      </TableCell>
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
            ) : !breakdown.data?.length ? (
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
              <RouteIcon className="h-4 w-4 text-indigo-600" /> Top Noisy Frontend Routes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {routes.isLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
            ) : !routes.data?.length ? (
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
            <Database className="h-4 w-4 text-amber-600" /> Database RLS Sweep
            {rlsIssues.length > 0 ? (
              <Badge variant="destructive" className="text-xs">{rlsIssues.length} issues</Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">All clear</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rls.isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading...</p>
          ) : rlsIssues.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Every public table has RLS enabled with at least one policy.</p>
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
            Sweep covers all <code className="font-mono">public.*</code> tables. For function search_path and other linter rules, run the Supabase linter from the database tooling.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
