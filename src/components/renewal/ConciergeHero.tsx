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
  good: 'border-lux-emerald/40 text-lux-emerald',
  soon: 'border-lux-amber/50 text-lux-amber',
  urgent: 'border-lux-rose/50 text-lux-rose',
  none: 'border-lux-mist/30 text-lux-mist',
};

/** Greeting plus the floating glass status card: plan, expiry and PT balance. */
export function ConciergeHero({
  memberName, memberCode, branchName, planName, endDate,
  daysRemaining, hasMembership, ptRemaining, ptTotal, trainerName,
}: ConciergeHeroProps) {
  const expiry = expiryTone(daysRemaining, hasMembership);
  const ptPercent = ptTotal > 0 ? Math.max(0, Math.min(100, (ptRemaining / ptTotal) * 100)) : 0;

  return (
    <section className="relative overflow-hidden rounded-[28px] bg-gradient-lux p-8 shadow-lux md:p-12">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-lux-gold/10 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-lux-bronze/10 blur-3xl" aria-hidden />

      <div className="relative grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.35em] text-lux-gold">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            Member Concierge
          </p>
          <h1 className="mt-5 text-4xl font-light tracking-tight text-lux-ivory md:text-5xl">
            Welcome back, <span className="font-medium">{memberName}</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed tracking-wide text-lux-mist">
            Extend your access, upgrade your experience or top up training sessions — all in a few taps.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-xs tracking-wide text-lux-mist">
            {memberCode && (
              <span className="rounded-full border border-lux-line/15 px-3 py-1.5">{memberCode}</span>
            )}
            {branchName && (
              <span className="rounded-full border border-lux-line/15 px-3 py-1.5">{branchName}</span>
            )}
          </div>
        </div>

        {/* Floating glass status card */}
        <div className="rounded-3xl border border-lux-line/10 bg-lux-ivory/[0.04] p-6 shadow-lux backdrop-blur-xl md:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.3em] text-lux-mist">Current status</p>
              <p className="mt-2 flex items-center gap-2 text-xl font-medium tracking-wide text-lux-ivory">
                <Crown className="h-5 w-5 text-lux-gold" aria-hidden />
                <span className="truncate">{planName ?? 'No active plan'}</span>
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium tracking-wide ${TONE_CLASS[expiry.tone]}`}>
              {expiry.label}
            </span>
          </div>

          <div className="mt-5 flex items-center gap-2 text-xs tracking-wide text-lux-mist">
            <CalendarCheck className="h-4 w-4 text-lux-gold/80" aria-hidden />
            Valid through {formatDate(endDate)}
          </div>

          <div className="mt-6 border-t border-lux-line/10 pt-5">
            <div className="flex items-center justify-between text-xs tracking-wide">
              <span className="flex items-center gap-2 text-lux-mist">
                <Dumbbell className="h-4 w-4 text-lux-gold/80" aria-hidden />
                Personal training
              </span>
              <span className="font-medium text-lux-ivory">
                {ptTotal > 0 ? `${ptRemaining} / ${ptTotal} remaining` : 'No active package'}
              </span>
            </div>
            <div
              className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-lux-ivory/10"
              role="progressbar"
              aria-valuenow={ptRemaining}
              aria-valuemin={0}
              aria-valuemax={ptTotal}
              aria-label="Personal training sessions remaining"
            >
              <div className="h-full rounded-full bg-gradient-gold transition-all duration-300" style={{ width: `${ptPercent}%` }} />
            </div>
            {trainerName && (
              <p className="mt-3 text-xs tracking-wide text-lux-mist">Coached by {trainerName}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default ConciergeHero;
