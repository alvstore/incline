import { useLayoutEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { format, subDays } from 'date-fns';
import { prefersReducedMotion } from '@/components/motion/pageMotion';

export type DecisionRow = { status: string; reviewed_at?: string | null; [k: string]: any };
export type BarSeries = { status: string; label: string; dot: string; bar: string };
const DEFAULT_SERIES: BarSeries[] = [
  { status: 'approved', label: 'Approved', dot: 'bg-success', bar: 'bg-success' },
  { status: 'rejected', label: 'Rejected', dot: 'bg-destructive', bar: 'bg-destructive/80' },
];

export function DecisionBarChart({ rows, series = DEFAULT_SERIES, dateKey = 'reviewed_at', summaryNoun = 'requests' }: { rows: DecisionRow[]; series?: BarSeries[]; dateKey?: string; summaryNoun?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const days = useMemo(() => {
    const out = Array.from({ length: 7 }, (_, i) => {
      const d = subDays(new Date(), 6 - i);
      return { key: format(d, 'yyyy-MM-dd'), label: format(d, 'EEE'), counts: series.map(() => 0) };
    });
    const idx = new Map(out.map((d, i) => [d.key, i]));
    rows.forEach((r) => {
      const at = r[dateKey];
      if (!at) return;
      const i = idx.get(format(new Date(at), 'yyyy-MM-dd'));
      const si = series.findIndex((x) => x.status === r.status);
      if (i == null || si < 0) return;
      out[i].counts[si]++;
    });
    return out;
  }, [rows, series, dateKey]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const max = Math.max(1, ...days.map((d) => sum(d.counts)));
  const totals = series.map((_, si) => days.reduce((s, d) => s + d.counts[si], 0));
  const sig = days.map((d) => d.counts.join('-')).join('|');

  useLayoutEffect(() => {
    if (!ref.current || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-bar]', { scaleY: 0, transformOrigin: 'bottom', duration: 1, ease: 'expo.out', delay: 0.15, stagger: 0.04, clearProps: 'transform' });
    }, ref);
    return () => ctx.revert();
  }, [sig]);

  return (
    <div ref={ref}>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted-foreground">
        {series.map((x, si) => <span key={x.status} className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${x.dot}`} />{x.label} {totals[si]}</span>)}
      </div>
      <p className="sr-only">In the last 7 days: {series.map((x, si) => `${totals[si]} ${summaryNoun} ${x.label.toLowerCase()}`).join(', ')}.</p>
      <div className="flex h-32 items-end gap-2" aria-hidden="true">
        {days.map((d, i) => {
          const today = i === days.length - 1;
          const total = sum(d.counts);
          return (
            <div key={d.key} className="group flex flex-1 flex-col items-center gap-1.5" title={`${d.label}: ${series.map((x, si) => `${d.counts[si]} ${x.label.toLowerCase()}`).join(', ')}`}>
              <div className="relative flex h-24 w-full max-w-9 flex-col justify-end overflow-hidden rounded-full bg-muted"
                style={{ backgroundImage: 'repeating-linear-gradient(135deg, hsl(var(--muted-foreground) / .18) 0 1.5px, transparent 1.5px 6px)' }}>
                {total > 0 && (
                  <div data-bar className="flex w-full flex-col overflow-hidden rounded-full" style={{ height: `${(total / max) * 100}%` }}>
                    {series.map((x, si) => d.counts[si] > 0 && (
                      <div key={x.status} className={si === 0 && today ? 'bg-primary' : `${x.bar} ${si === 0 ? 'group-hover:bg-primary transition-colors' : ''}`} style={{ flex: d.counts[si] }} />
                    )).reverse()}
                  </div>
                )}
              </div>
              <span className={`text-[11px] font-semibold ${today ? 'text-primary' : 'text-muted-foreground'}`}>{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
