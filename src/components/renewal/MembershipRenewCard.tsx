import { ArrowUpRight, Check, Clock3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/renewal/conciergePricing';
import type { ConciergePlanOption } from '@/types/concierge';

interface MembershipRenewCardProps {
  plan: ConciergePlanOption;
  variant?: 'renew' | 'upgrade';
  ctaLabel: string;
  footnote?: string;
  onSelect: (plan: ConciergePlanOption) => void;
}

export function MembershipRenewCard({
  plan, variant = 'renew', ctaLabel, footnote, onSelect,
}: MembershipRenewCardProps) {
  const isUpgrade = variant === 'upgrade';

  return (
    <article
      className={`relative overflow-hidden rounded-2xl bg-white p-6 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-primary/10 md:p-7 ${
        isUpgrade ? 'ring-2 ring-primary/40' : ''
      }`}
    >
      {isUpgrade && (
        <span className="absolute right-5 top-5 rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
          Upgrade
        </span>
      )}

      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {isUpgrade ? 'Elevate your access' : 'Your plan'}
      </p>
      <h3 className="mt-2 pr-20 text-xl font-bold text-slate-900">{plan.name}</h3>
      {plan.description && (
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{plan.description}</p>
      )}

      <div className="mt-5 flex items-end gap-2">
        <span className="text-3xl font-bold text-slate-900">{formatINR(plan.price)}</span>
        <span className="flex items-center gap-1 pb-1 text-xs text-slate-500">
          <Clock3 className="h-3.5 w-3.5" aria-hidden />
          {plan.durationDays} days
        </span>
      </div>
      {footnote && <p className="mt-1 text-xs text-slate-500">{footnote}</p>}

      {plan.perks.length > 0 && (
        <ul className="mt-5 space-y-2">
          {plan.perks.map((perk) => (
            <li key={perk} className="flex items-start gap-2.5 text-sm text-slate-700">
              <span className="mt-0.5 rounded-full bg-emerald-50 p-0.5 text-emerald-600"><Check className="h-3.5 w-3.5" aria-hidden /></span>
              {perk}
            </li>
          ))}
        </ul>
      )}

      <Button
        onClick={() => onSelect(plan)}
        variant={isUpgrade ? 'default' : 'outline'}
        className={`mt-6 h-12 w-full cursor-pointer rounded-xl text-sm font-semibold focus-visible:ring-2 focus-visible:ring-ring ${
          isUpgrade ? 'bg-theme-gradient text-white hover:opacity-90' : 'border-primary/30 text-primary hover:bg-primary/10'
        }`}
      >
        {ctaLabel}
        <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden />
      </Button>
    </article>
  );
}

export default MembershipRenewCard;
