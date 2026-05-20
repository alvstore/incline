import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, TrendingUp, TrendingDown } from 'lucide-react';
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, subDays, subMonths, format,
} from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart, PieChart, Pie, Cell } from 'recharts';
import { useSalesReport } from '@/lib/finance/useSalesReport';
import { exportDailySales, exportStreamSales } from '@/lib/finance/csvExports';
import { DateRangeFilter } from '@/components/ui/date-range-filter';

const STREAM_LABELS: Record<string, string> = {
  membership: 'Memberships', pt_package: 'PT Packages', addon: 'Add-ons',
  class: 'Classes', pos: 'POS Retail', other: 'Other',
};

const STREAM_COLORS = ['hsl(217 91% 60%)', 'hsl(270 76% 58%)', 'hsl(142 71% 45%)', 'hsl(38 92% 50%)', 'hsl(330 81% 60%)', 'hsl(215 14% 58%)'];

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom';

function rangeFor(p: Preset): { from: Date; to: Date } {
  const now = new Date();
  switch (p) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': { const y = subDays(now, 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case 'week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'month': return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'last_month': { const m = subMonths(now, 1); return { from: startOfMonth(m), to: endOfMonth(m) }; }
    default: return { from: startOfMonth(now), to: endOfMonth(now) };
  }
}

export function SalesReportTab({ branchId, formatCurrency }: { branchId: string | undefined; formatCurrency: (n: number) => string }) {
  const [preset, setPreset] = useState<Preset>('month');
  const [customRange, setCustomRange] = useState<{ from: Date; to: Date } | null>(null);
  const range = preset === 'custom' ? customRange : rangeFor(preset);

  const { data, isLoading } = useSalesReport(branchId, range);

  return (
    <div className="space-y-6">
      {/* Range chips */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3 shadow-lg shadow-primary/10">
        {([
          ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'],
          ['month', 'This Month'], ['last_month', 'Last Month'],
        ] as [Preset, string][]).map(([k, label]) => (
          <Button key={k} size="sm" variant={preset === k ? 'default' : 'outline'} onClick={() => setPreset(k)} className="rounded-full">
            {label}
          </Button>
        ))}
        <Button size="sm" variant={preset === 'custom' ? 'default' : 'outline'} onClick={() => setPreset('custom')} className="rounded-full">
          Custom
        </Button>
        {preset === 'custom' && <DateRangeFilter value={customRange} onChange={setCustomRange} />}
        <div className="ml-auto text-xs text-muted-foreground">
          {range && `${format(range.from, 'MMM d')} → ${format(range.to, 'MMM d, yyyy')}`}
        </div>
      </div>

      {isLoading || !data ? (
        <>
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </>
      ) : (
        <>
          {/* Hero KPIs */}
          <Card className="rounded-2xl border-none bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/30">
            <CardContent className="grid grid-cols-2 gap-6 p-6 md:grid-cols-6">
              <Kpi label="Gross Sales" value={formatCurrency(data.totals.gross)} highlight />
              <Kpi label="Net (ex-GST)" value={formatCurrency(data.totals.net)} />
              <Kpi label="Tax Collected" value={formatCurrency(data.totals.tax)} />
              <Kpi label="Transactions" value={String(data.totals.txns)} />
              <Kpi label="Avg Order" value={formatCurrency(data.totals.aov)} />
              <Kpi label="Refunds" value={formatCurrency(data.totals.refunds)} />
            </CardContent>
          </Card>

          {/* Trend + donut */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="rounded-2xl border-none shadow-lg shadow-primary/10 lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base font-bold">Sales Trend</CardTitle>
                <CardDescription>Daily gross sales for the selected period</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data.daily}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => format(new Date(v), 'd MMM')} />
                      <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px' }} />
                      <Bar dataKey="gross" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} name="Gross" />
                      <Line type="monotone" dataKey="net" stroke="hsl(142 71% 45%)" strokeWidth={2} dot={false} name="Net" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
              <CardHeader>
                <CardTitle className="text-base font-bold">By Stream</CardTitle>
                <CardDescription>Revenue split by product line</CardDescription>
              </CardHeader>
              <CardContent>
                {data.byStream.length ? (
                  <>
                    <div className="h-[200px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={data.byStream} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="gross">
                            {data.byStream.map((_, i) => <Cell key={i} fill={STREAM_COLORS[i % STREAM_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={{ backgroundColor: 'hsl(var(--card))', border: 'none', borderRadius: '12px' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-1.5 pt-2 text-sm">
                      {data.byStream.map((s, i) => (
                        <div key={s.stream} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: STREAM_COLORS[i % STREAM_COLORS.length] }} />
                            <span className="text-muted-foreground">{STREAM_LABELS[s.stream] || s.stream}</span>
                          </div>
                          <span className="font-semibold">{formatCurrency(s.gross)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="py-12 text-center text-sm text-muted-foreground">No sales data</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Payment methods */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
            <CardHeader>
              <CardTitle className="text-base font-bold">By Payment Method</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                {data.byMethod.map(m => (
                  <div key={m.name} className="rounded-xl bg-muted/30 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{m.name}</p>
                    <p className="mt-1 text-lg font-bold text-foreground">{formatCurrency(m.value)}</p>
                  </div>
                ))}
                {!data.byMethod.length && <p className="text-sm text-muted-foreground">No payment data</p>}
              </div>
            </CardContent>
          </Card>

          {/* By branch (only when all) */}
          {data.byBranch.length > 1 && (
            <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
              <CardHeader>
                <CardTitle className="text-base font-bold">By Branch</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Branch</TableHead><TableHead className="text-right">Transactions</TableHead><TableHead className="text-right">Gross</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.byBranch.map(b => (
                      <TableRow key={b.branch_id}>
                        <TableCell className="font-medium">{b.name}</TableCell>
                        <TableCell className="text-right">{b.txns}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(b.gross)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* By stream table */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Revenue Streams</CardTitle>
                <CardDescription>Membership · PT · POS · Add-ons · Classes</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => exportStreamSales(data.byStream)} disabled={!data.byStream.length}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stream</TableHead>
                    <TableHead className="text-right">Transactions</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byStream.map(s => (
                    <TableRow key={s.stream}>
                      <TableCell><Badge variant="outline">{STREAM_LABELS[s.stream] || s.stream}</Badge></TableCell>
                      <TableCell className="text-right">{s.txns}</TableCell>
                      <TableCell className="text-right">{formatCurrency(s.gross)}</TableCell>
                      <TableCell className="text-right text-primary">{formatCurrency(s.tax)}</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(s.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Date-wise sales */}
          <Card className="rounded-2xl border-none shadow-lg shadow-primary/10">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold">Date-wise Sales</CardTitle>
                <CardDescription>Day-by-day breakdown — send to accountant</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => exportDailySales(data.daily)} disabled={!data.daily.length}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </CardHeader>
            <CardContent>
              <div className="max-h-[480px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Txns</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.daily.slice().reverse().map((d, i, arr) => {
                      const prev = arr[i + 1];
                      const trendUp = prev ? d.gross >= prev.gross : true;
                      return (
                        <TableRow key={d.date}>
                          <TableCell className="font-medium">{format(new Date(d.date), 'EEE, d MMM')}</TableCell>
                          <TableCell className="text-right">{d.txns}</TableCell>
                          <TableCell className="text-right font-bold">{formatCurrency(d.gross)}</TableCell>
                          <TableCell className="text-right text-primary">{formatCurrency(d.tax)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(d.net)}</TableCell>
                          <TableCell className="text-right">
                            {d.gross > 0 && (trendUp
                              ? <TrendingUp className="ml-auto h-4 w-4 text-emerald-500" />
                              : <TrendingDown className="ml-auto h-4 w-4 text-red-500" />)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">{label}</p>
      <p className={`mt-1 ${highlight ? 'text-2xl font-bold' : 'text-xl font-semibold'} text-white`}>{value}</p>
    </div>
  );
}
