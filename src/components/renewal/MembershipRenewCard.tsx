import { ArrowUpRight, Check, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/renewal/conciergePricing';
import type { ConciergePlanOption } from '@/types/concierge';

interface MembershipRenewCardProps {
  plan: ConciergePlanOption;
  /** Highlighted upsell styling. */
  variant?: 'renew' | 'upgrade';
  ctaLabel: string;
  /** Line shown under the price, e.g. new validity date. */
  footnote?: string;
  onSelect: (plan: ConciergePlanOption) => void;
}

export function MembershipRenewCard({
  plan, variant = 'renew', ctaLabel, footnote, onSelect,
}: MembershipRenewCardProps) {
  const isUpgrade = variant === 'upgrade';

  return (
    <article
      className={`group relative overflow-hidden rounded-3xl border p-6 backdrop-blur-xl transition-all duration-200 md:p-7 ${
        isUpgrade
          ? 'border-lux-gold/35 bg-lux-gold/[0.06] shadow-gold hover:border-lux-gold/60'
          : 'border-lux-line/10 bg-lux-ivory/[0.04] shadow-lux hover:border-lux-gold/35'
      }`}
    >
      {isUpgrade && (
        <span className="absolute right-6 top-6 rounded-full bg-gradient-gold px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-lux-obsidian">
          Upgrade
        </span>
      )}

      <p className="text-[11px] uppercase tracking-[0.3em] text-lux-mist">
        {isUpgrade ? 'Elevate your access' : 'Your plan'}
      </p>
      <h3 className="mt-3 text-2xl font-light tracking-wide text-lux-ivory">{plan.name}</h3>
      {plan.description && (
        <p className="mt-2 text-sm leading-relaxed tracking-wide text-lux-mist">{plan.description}</p>
      )}

      <div className="mt-6 flex items-end gap-2">
        <span className="text-3xl font-medium tracking-tight text-lux-ivory">{formatINR(plan.price)}</span>
        <span className="pb-1 flex items-center gap-1 text-xs tracking-wide text-lux-mist">
          <Clock3 className="h-3.5 w-3.5" aria-hidden />
          {plan.durationDays} days
        </span>
      </div>
      {footnote && <p className="mt-2 text-xs tracking-wide text-lux-mist">{footnote}</p>}

      {plan.perks.length > 0 && (
        <ul className="mt-6 space-y-2.5">
          {plan.perks.map((perk) => (
            <li key={perk} className="flex items-start gap-2.5 text-sm tracking-wide text-lux-ivory/85">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-lux-gold" aria-hidden />
              {perk}
            </li>
          ))}
        </ul>
      )}

      <Button
        onClick={() => onSelect(plan)}
        className={`mt-7 h-12 w-full cursor-pointer rounded-2xl text-sm font-medium tracking-wide transition-all duration-200 focus-visible:ring-2 focus-visible:ring-lux-gold focus-visible:ring-offset-0 ${
          isUpgrade
            ? 'bg-gradient-gold text-lux-obsidian hover:opacity-90'
            : 'border border-lux-line/20 bg-lux-ivory/5 text-lux-ivory hover:bg-lux-ivory/10'
        }`}
      >
        {ctaLabel}
        <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden />
      </Button>
    </article>
  );
}

export default MembershipRenewCard;
