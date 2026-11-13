import { useLayoutEffect, useMemo, useRef } from 'react';
import gsap from 'gsap';
import { format, subDays } from 'date-fns';
import { prefersReducedMotion } from './approvalMotion';

export type DecisionRow = { status: string; reviewed_at: string | null };

export function ApprovalTrendChart({ rows }: { rows: DecisionRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const days = useMemo(() => {
    const out = Array.from({ length: 7 }, (_, i) => {
      const d = subDays(new Date(), 6 - i);
      return { key: format(d, 'yyyy-MM-dd'), label: format(d, 'EEE'), approved: 0, rejected: 0 };
    });
    const idx = new Map(out.map((d, i) => [d.key, i]));
    rows.forEach((r) => {
      if (!r.reviewed_at) return;
      const i = idx.get(format(new Date(r.reviewed_at), 'yyyy-MM-dd'));
      if (i == null) return;
      if (r.status === 'approved') out[i].approved++; else if (r.status === 'rejected') out[i].rejected++;
    });
    return out;
  }, [rows]);
  const max = Math.max(1, ...days.map((d) => d.approved + d.rejected));
  const totalA = days.reduce((s, d) => s + d.approved, 0);
  const totalR = days.reduce((s, d) => s + d.rejected, 0);
  const sig = days.map((d) => `${d.approved}-${d.rejected}`).join('|');

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
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" />Approved {totalA}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-destructive" />Rejected {totalR}</span>
      </div>
      <p className="sr-only">In the last 7 days, {totalA} requests were approved and {totalR} rejected.</p>
      <div className="flex h-32 items-end gap-2" aria-hidden="true">
        {days.map((d, i) => {
          const today = i === days.length - 1;
          const total = d.approved + d.rejected;
          return (
            <div key={d.key} className="group flex flex-1 flex-col items-center gap-1.5" title={`${d.label}: ${d.approved} approved, ${d.rejected} rejected`}>
              <div className="relative flex h-24 w-full max-w-9 flex-col justify-end overflow-hidden rounded-full bg-muted"
                style={{ backgroundImage: 'repeating-linear-gradient(135deg, hsl(var(--muted-foreground) / .18) 0 1.5px, transparent 1.5px 6px)' }}>
                {total > 0 && (
                  <div data-bar className="flex w-full flex-col overflow-hidden rounded-full" style={{ height: `${(total / max) * 100}%` }}>
                    {d.rejected > 0 && <div className="bg-destructive/80" style={{ flex: d.rejected }} />}
                    {d.approved > 0 && <div className={today ? 'bg-primary' : 'bg-success group-hover:bg-primary transition-colors'} style={{ flex: d.approved }} />}
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
