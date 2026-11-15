import { useMemo } from 'react';
import { Bar, BarChart, ComposedChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CountUp, prefersReducedMotion } from '@/components/motion/pageMotion';
import { shiftBlocks, type MatchTrainerRow, type TrainerFit, type UsualWindow } from '@/lib/trainers/trainerMatch';
import { cn } from '@/lib/utils';

const initials = (n?: string | null) => (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export function PersonAvatar({ name, src, className }: { name?: string | null; src?: string | null; className?: string }) {
  return (
    <Avatar className={cn('h-9 w-9 shrink-0', className)}>
      {src && <AvatarImage src={src} alt="" loading="lazy" className="object-cover animate-in fade-in duration-500" />}
      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

type Row = { w: UsualWindow; fits: TrainerFit[] };
const isReady = (f?: TrainerFit) => !!f && !f.atCapacity && f.overlap >= 0.4;

export function UnassignedStats({ rows, trainers, onSelectReady }: { rows: Row[]; trainers: MatchTrainerRow[]; onSelectReady: () => void }) {
  const anim = !prefersReducedMotion();
  const stats = useMemo(() => {
    const c = { strong: 0, some: 0, none: 0 };
    rows.forEach((r) => c[r.w.confidence]++);
    return { ...c, ready: rows.filter((r) => isReady(r.fits[0])).length };
  }, [rows]);

  const hours = useMemo(() => {
    const today = new Date().getDay();
    return Array.from({ length: 18 }, (_, i) => {
      const h = 5 + i, a = h * 60, b = a + 60;
      const members = rows.filter((r) => r.w.part !== 'Unknown' && Math.floor(r.w.start / 60) === h).length;
      const onShift = trainers.filter((t) => shiftBlocks(t, today).some(([x, y]) => x < b && y > a)).length;
      return { label: `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`, members, onShift };
    });
  }, [rows, trainers]);
  const peak = hours.reduce((p, h) => (h.members > p.members ? h : p), hours[0]);
  const gaps = hours.filter((h) => h.members > 0 && h.onShift === 0).length;

  const load = useMemo(() => trainers.map((t) => ({
    name: (t.name ?? 'Trainer').split(' ')[0], used: Math.min(100, Math.round((t.clients / Math.max(1, t.max_clients)) * 100)), full: t.clients >= t.max_clients,
  })).sort((a, b) => b.used - a.used), [trainers]);

  const tip = { contentStyle: { background: 'hsl(var(--popover))', border: 'none', borderRadius: 12, fontSize: 12, boxShadow: '0 8px 24px -12px hsl(var(--foreground) / 0.25)' }, cursor: { fill: 'hsl(var(--muted) / 0.5)' } };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card data-anim="card" className="rounded-2xl shadow-sm">
        <CardContent className="p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Without a trainer</p>
          <CountUp value={rows.length} className="text-3xl font-bold tabular-nums" />
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            {(['strong', 'some', 'none'] as const).map((k, i) => (
              <div key={k} className={cn('h-full transition-[width] duration-700', ['bg-success', 'bg-warning', 'bg-muted-foreground/40'][i])} style={{ width: `${rows.length ? (stats[k] / rows.length) * 100 : 0}%` }} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{stats.strong} strong · {stats.some} some · {stats.none} not enough history</p>
        </CardContent>
      </Card>

      <Card data-anim="card" className="rounded-2xl shadow-sm">
        <CardContent className="p-4 space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Ready to assign</p>
          <div className="flex items-baseline gap-2">
            <CountUp value={stats.ready} className="text-3xl font-bold tabular-nums text-success" />
            <span className="text-xs text-muted-foreground">{rows.length ? Math.round((stats.ready / rows.length) * 100) : 0}% have a Best/Good match</span>
          </div>
          <Button size="sm" variant="outline" className="rounded-xl w-full" disabled={!stats.ready} onClick={onSelectReady}>Select these</Button>
        </CardContent>
      </Card>

      <Card data-anim="card" className="rounded-2xl shadow-sm">
        <CardContent className="p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">When they arrive vs trainers on shift today</p>
          <div className="h-[92px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={hours} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval={2} />
                <YAxis hide yAxisId="m" /><YAxis hide yAxisId="t" />
                <Tooltip {...tip} formatter={(v: number, k: string) => [v, k === 'members' ? 'Members arrive' : 'Trainers on shift']} />
                <Area yAxisId="t" type="step" dataKey="onShift" stroke="none" fill="hsl(var(--info) / 0.15)" isAnimationActive={anim} />
                <Bar yAxisId="m" dataKey="members" radius={[4, 4, 0, 0]} isAnimationActive={anim} animationDuration={900}>
                  {hours.map((h, i) => <Cell key={i} fill={h.members && !h.onShift ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'} />)}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">Peak {peak?.members ? peak.label.replace('a', ' AM').replace('p', ' PM') : '—'}{gaps ? ` · ${gaps} hour${gaps > 1 ? 's' : ''} with no trainer (red)` : ' · all arrival hours covered'}</p>
        </CardContent>
      </Card>

      <Card data-anim="card" className="rounded-2xl shadow-sm">
        <CardContent className="p-4 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Trainer load (% of client limit)</p>
          <div className="h-[92px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={load} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} interval={0} />
                <YAxis hide domain={[0, 100]} />
                <Tooltip {...tip} formatter={(v: number) => [`${v}%`, 'Load']} />
                <Bar dataKey="used" radius={[4, 4, 0, 0]} isAnimationActive={anim} animationDuration={900}>
                  {load.map((l, i) => <Cell key={i} fill={l.full ? 'hsl(var(--destructive))' : l.used > 75 ? 'hsl(var(--warning))' : 'hsl(var(--success))'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">{load.filter((l) => l.full).length} full · {load.filter((l) => !l.full && l.used <= 75).length} with room</p>
        </CardContent>
      </Card>
    </div>
  );
}
