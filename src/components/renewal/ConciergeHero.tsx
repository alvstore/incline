import { CalendarCheck, Crown, Dumbbell, Sparkles } from 'lucide-react';
import { expiryTone, formatDate } from '@/lib/renewal/conciergePricing';

interface ConciergeHeroProps {
  memberName: string;
  memberCode: string | null;
  branchName: string | null;
  planName: string | null;
  endDate: string | null;
  daysRemaining: number;
  hasMembership: boolean;
  ptRemaining: number;
  ptTotal: number;
  trainerName: string | null;
}

const TONE_CLASS: Record<string, string> = {
  good: 'bg-emerald-100 text-emerald-700',
  soon: 'bg-amber-100 text-amber-700',
  urgent: 'bg-red-100 text-red-700',
  none: 'bg-slate-100 text-slate-600',
};

/** Greeting plus the status card: plan, expiry and PT balance. */
export function ConciergeHero({
  memberName, memberCode, branchName, planName, endDate,
  daysRemaining, hasMembership, ptRemaining, ptTotal, trainerName,
}: ConciergeHeroProps) {
  const expiry = expiryTone(daysRemaining, hasMembership);
  const ptPercent = ptTotal > 0 ? Math.max(0, Math.min(100, (ptRemaining / ptTotal) * 100)) : 0;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 p-6 text-white shadow-lg shadow-indigo-500/20 md:p-10">
      <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden />

      <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-100">
            <Sparkles className="h-4 w-4" aria-hidden />
            Renew &amp; Upgrade
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl">
            Welcome back, {memberName}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-indigo-100">
            Extend your access, upgrade your plan or top up training sessions in a few taps.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-medium">
            {memberCode && <span className="rounded-full bg-white/15 px-3 py-1">{memberCode}</span>}
            {branchName && <span className="rounded-full bg-white/15 px-3 py-1">{branchName}</span>}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 text-slate-900 shadow-xl shadow-indigo-900/20">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current plan</p>
              <p className="mt-2 flex items-center gap-2 text-lg font-bold">
                <span className="rounded-full bg-indigo-50 p-2 text-indigo-600"><Crown className="h-4 w-4" aria-hidden /></span>
                <span className="truncate">{planName ?? 'No active plan'}</span>
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[expiry.tone]}`}>
              {expiry.label}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <CalendarCheck className="h-4 w-4 text-indigo-600" aria-hidden />
            Valid through <span className="font-medium text-slate-900">{formatDate(endDate)}</span>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-500">
                <Dumbbell className="h-4 w-4 text-indigo-600" aria-hidden />
                Personal training
              </span>
              <span className="font-semibold">
                {ptTotal > 0 ? `${ptRemaining} / ${ptTotal} left` : 'No active package'}
              </span>
            </div>
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuenow={ptRemaining}
              aria-valuemin={0}
              aria-valuemax={ptTotal}
              aria-label="Personal training sessions remaining"
            >
              <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 transition-all duration-300" style={{ width: `${ptPercent}%` }} />
            </div>
            {trainerName && <p className="mt-3 text-xs text-slate-500">Coached by {trainerName}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

export default ConciergeHero;
