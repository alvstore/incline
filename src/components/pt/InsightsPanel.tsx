import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { Crown, Package, TrendingUp, IndianRupee } from 'lucide-react';
import { cn } from '@/lib/utils';
import { avatarColor, formatINR, initialsOf, type TrainerRevenueRow } from './ptTypes';

interface Props {
  trainerRevenue: TrainerRevenueRow[];
  packageTypeSplit: Array<{ name: string; value: number; color: string }>;
  totalRevenue: number;
  completedCount: number;
  scheduledCount: number;
  cancelledCount: number;
  canManage: boolean;
  onCreatePackage: () => void;
}

/** Secondary analytics — kept below the operational tabs on purpose. */
export function InsightsPanel({
  trainerRevenue,
  packageTypeSplit,
  totalRevenue,
  completedCount,
  scheduledCount,
  cancelledCount,
  canManage,
  onCreatePackage,
}: Props) {
  const topPerformer = trainerRevenue[0];
  const topThree = trainerRevenue.slice(0, 3);
  const topRevenue = topThree[0]?.revenue || 0;
  const typeTotal = packageTypeSplit.reduce((s, p) => s + p.value, 0);
  const totalSessions = completedCount + scheduledCount + cancelledCount;

  return (
    <div className="space-y-4">
      {totalSessions > 0 && (
        <Card className="rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50">
          <CardContent className="py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Session status
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill color="emerald" label="Completed" count={completedCount} />
                  <StatusPill color="indigo" label="Scheduled" count={scheduledCount} />
                  <StatusPill color="rose" label="Cancelled" count={cancelledCount} />
                </div>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted md:w-72">
                <div className="bg-success" style={{ width: `${(completedCount / totalSessions) * 100}%` }} />
                <div className="bg-primary" style={{ width: `${(scheduledCount / totalSessions) * 100}%` }} />
                <div
                  className="bg-destructive"
                  style={{ width: `${(cancelledCount / totalSessions) * 100}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Top performer */}
        <Card className="relative overflow-hidden rounded-2xl border-0 bg-gradient-to-br from-primary via-primary to-primary/90 text-primary-foreground shadow-lg shadow-primary/20">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <CardHeader className="relative z-10 pb-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/70">
                Top performer
              </p>
              <span className="rounded-full bg-warning/20 p-1.5 ring-1 ring-warning/30" aria-hidden>
                <Crown className="h-4 w-4 text-warning-foreground" />
              </span>
            </div>
          </CardHeader>
          <CardContent className="relative z-10 space-y-4">
            {topPerformer ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12 ring-2 ring-primary-foreground/30">
                    <AvatarImage src={topPerformer.avatarUrl || undefined} alt={topPerformer.name} />
                    <AvatarFallback className="bg-primary-foreground/15 text-primary-foreground text-base font-bold">
                      {initialsOf(topPerformer.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold leading-tight">{topPerformer.name}</p>
                    <p className="text-xs text-primary-foreground/70">Leading this period</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
                    <p className="text-[10px] uppercase tracking-wider text-primary-foreground/60">
                      Revenue
                    </p>
                    <p className="flex items-center text-lg font-bold">
                      <IndianRupee className="h-4 w-4" aria-hidden />
                      {topPerformer.revenue.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur">
                    <p className="text-[10px] uppercase tracking-wider text-primary-foreground/60">
                      Clients
                    </p>
                    <p className="text-lg font-bold">{topPerformer.clients}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center py-6 text-center">
                <span
                  className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/10"
                  aria-hidden
                >
                  <Crown className="h-5 w-5 text-primary-foreground/70" />
                </span>
                <p className="text-sm font-medium">No active packages yet</p>
                {canManage && (
                  <button
                    onClick={onCreatePackage}
                    className="mt-3 cursor-pointer rounded text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    Create your first package
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Package split */}
        <Card className="rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground">Package type split</CardTitle>
            <p className="text-xs text-muted-foreground">How your active clients are distributed.</p>
          </CardHeader>
          <CardContent>
            {typeTotal > 0 ? (
              <div className="flex items-center gap-4">
                <div className="relative h-32 w-32 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={packageTypeSplit.filter((d) => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={42}
                        outerRadius={58}
                        paddingAngle={3}
                        dataKey="value"
                        stroke="none"
                      >
                        {packageTypeSplit
                          .filter((d) => d.value > 0)
                          .map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold leading-none text-foreground">{typeTotal}</span>
                    <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                      Active
                    </span>
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {packageTypeSplit.map((d) => {
                    const pct = typeTotal ? Math.round((d.value / typeTotal) * 100) : 0;
                    return (
                      <div key={d.name} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 flex-shrink-0 rounded-sm"
                              style={{ background: d.color }}
                              aria-hidden
                            />
                            <span className="truncate font-medium text-foreground">{d.name}</span>
                          </span>
                          <span className="font-semibold tabular-nums text-foreground">
                            {d.value} · {pct}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, background: d.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyMini icon={<Package className="h-5 w-5" />} title="No packages yet" hint="Active packages will appear here." />
            )}
          </CardContent>
        </Card>

        {/* Revenue by trainer */}
        <Card className="rounded-2xl border-0 bg-card shadow-lg shadow-slate-200/50">
          <CardHeader className="flex flex-row items-start justify-between pb-2">
            <div>
              <CardTitle className="text-sm font-semibold text-foreground">Revenue by trainer</CardTitle>
              <p className="text-xs text-muted-foreground">Top earners this period.</p>
            </div>
            {totalRevenue > 0 && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
                <p className="text-sm font-bold text-foreground">{formatINR(totalRevenue)}</p>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {trainerRevenue.length > 0 ? (
              <ul className="space-y-3">
                {trainerRevenue.slice(0, 5).map((t, i) => {
                  const pct = topRevenue ? Math.max(4, (t.revenue / topRevenue) * 100) : 0;
                  return (
                    <li key={`${t.name}-${i}`} className="flex items-center gap-3">
                      <span
                        className={cn(
                          'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                          i === 0 ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {i + 1}
                      </span>
                       <Avatar className="h-8 w-8 flex-shrink-0">
                         <AvatarImage src={t.avatarUrl || undefined} alt={t.name} />
                         <AvatarFallback className={cn('text-xs font-semibold', avatarColor(t.name))}>
                           {initialsOf(t.name)}
                         </AvatarFallback>
                       </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-foreground">{t.name}</p>
                          <p className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground">
                            {formatINR(t.revenue)}
                          </p>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="flex-shrink-0 text-[10px] font-medium text-muted-foreground">
                            {t.clients} client{t.clients === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyMini
                icon={<TrendingUp className="h-5 w-5" />}
                title="No revenue yet"
                hint="Revenue will appear once packages are sold."
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusPill({
  color,
  label,
  count,
}: {
  color: 'emerald' | 'indigo' | 'rose';
  label: string;
  count: number;
}) {
  const map = {
    emerald: 'bg-success/10 text-success',
    indigo: 'bg-primary/10 text-primary',
    rose: 'bg-destructive/10 text-destructive',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        map[color],
      )}
    >
      {label} <span className="font-bold tabular-nums">{count}</span>
    </span>
  );
}

function EmptyMini({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <span
        className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-0.5 max-w-[200px] text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
