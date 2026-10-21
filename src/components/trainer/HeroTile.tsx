import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type HeroTone = 'accent' | 'primary' | 'info' | 'success';

const toneCls: Record<HeroTone, { tile: string; icon: string }> = {
  accent: { tile: 'bg-accent text-accent-foreground shadow-[0_18px_40px_-18px_hsl(var(--accent)/0.7)]', icon: 'text-accent' },
  primary: { tile: 'bg-primary text-primary-foreground shadow-[0_18px_40px_-18px_hsl(var(--primary)/0.7)]', icon: 'text-primary' },
  info: { tile: 'bg-info text-info-foreground shadow-[0_18px_40px_-18px_hsl(var(--info)/0.7)]', icon: 'text-info' },
  success: { tile: 'bg-success text-success-foreground shadow-[0_18px_40px_-18px_hsl(var(--success)/0.7)]', icon: 'text-success' },
};

/** Tall solid tile: icon chip, label, big number, small secondary line. */
export function HeroTile({ label, value, sub, icon: Icon, tone, to, loading }: {
  label: string; value: ReactNode; sub?: ReactNode; icon: ComponentType<{ className?: string }>;
  tone: HeroTone; to?: string; loading?: boolean;
}) {
  const t = toneCls[tone];
  const body = (
    <div className={cn(
      'group relative flex h-full min-h-[180px] flex-col justify-between overflow-hidden rounded-2xl p-5 transition-transform duration-200 hover:-translate-y-1 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      t.tile,
    )}>
      <span aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:repeating-radial-gradient(circle_at_100%_0%,currentColor_0_1px,transparent_1px_14px)]" />
      <div className="relative flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-background">
          <Icon className={cn('h-5 w-5', t.icon)} />
        </span>
        {to && <ArrowUpRight className="h-4 w-4 opacity-70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />}
      </div>
      <div className="relative">
        <p className="text-sm font-semibold opacity-90">{label}</p>
        {loading ? <Skeleton className="mt-2 h-8 w-24 bg-background/30" /> : (
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
        )}
        {sub && <p className="mt-0.5 truncate text-xs opacity-80">{sub}</p>}
      </div>
    </div>
  );
  return to ? (
    <Link to={to} aria-label={`${label}: open`} className="block h-full cursor-pointer rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{body}</Link>
  ) : body;
}
