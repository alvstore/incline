import { Link } from 'react-router-dom';
import { Droplets, Flame, Snowflake, Waves, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useBenefitBalances } from '@/hooks/useBenefits';
import { Skeleton } from '@/components/ui/skeleton';

const RECOVERY = ['sauna_access', 'sauna_session', 'steam_access', 'ice_bath', 'spa_access', 'pool_access'];
const iconFor = (t: string): LucideIcon => t.includes('ice') ? Snowflake : t.includes('steam') ? Droplets : t.includes('sauna') ? Flame : Waves;

export function RecoveryTray({ memberId, disabled }: { memberId: string; disabled?: boolean }) {
  const { balances, isLoading } = useBenefitBalances(memberId);
  const items = balances.filter(b => RECOVERY.includes(b.benefit_type));

  return (
    <section aria-labelledby="recovery-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="recovery-title" className="text-lg font-bold text-foreground">Recovery</h2>
        <Link to="/book?type=recovery" className="flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">Book a slot<ChevronRight className="h-4 w-4" /></Link>
      </div>
      {isLoading ? <div className="flex gap-3"><Skeleton className="h-32 w-36 rounded-2xl" /><Skeleton className="h-32 w-36 rounded-2xl" /></div>
        : items.length === 0 ? (
          <Link to="/member-store" className="block rounded-2xl bg-card p-5 shadow-lg shadow-slate-200/50 transition-shadow duration-200 hover:shadow-xl hover:shadow-primary/10 dark:shadow-none">
            <p className="font-semibold text-foreground">Add sauna, steam or ice bath</p>
            <p className="mt-1 text-sm text-muted-foreground">Recovery isn’t part of your plan yet — browse add-on packs.</p>
          </Link>
        ) : (
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0">
            {items.map(b => {
              const Icon = iconFor(b.benefit_type);
              const left = b.isUnlimited ? null : (b.remaining ?? 0) + (b.compRemaining ?? 0);
              const total = b.isUnlimited ? null : (b.limit_count ?? 0) + (b.compTotal ?? 0);
              const pct = total ? Math.min(100, Math.round(((left ?? 0) / total) * 100)) : 100;
              return (
                <Link key={`${b.benefit_type}-${b.benefit_type_id ?? ''}`} to={disabled ? '/member-dashboard' : '/book?type=recovery'} aria-disabled={disabled}
                  className="group min-w-[9.5rem] snap-start rounded-2xl bg-card p-4 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:shadow-none">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" aria-hidden /></span>
                  <p className="mt-3 truncate text-sm font-semibold text-foreground">{b.label}</p>
                  <p className="text-xs text-muted-foreground">{left === null ? 'Unlimited' : `${left} left`}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-theme-gradient" style={{ width: `${pct}%` }} /></div>
                </Link>
              );
            })}
          </div>
        )}
    </section>
  );
}
