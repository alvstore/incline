import { useEffect, useState } from 'react';
import { ArrowUpRight, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/renewal/conciergePricing';
import type { ConciergePtOption } from '@/types/concierge';

interface PtTopUpPanelProps {
  options: ConciergePtOption[];
  trainerName: string | null;
  remaining: number;
  onSelect: (option: ConciergePtOption) => void;
}

/** Session-count selector for topping up personal training. */
export function PtTopUpPanel({ options, trainerName, remaining, onSelect }: PtTopUpPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(options[0]?.id ?? null);

  useEffect(() => {
    if (options.length > 0 && !options.some((o) => o.id === selectedId)) {
      setSelectedId(options[0].id);
    }
  }, [options, selectedId]);

  const selected = options.find((o) => o.id === selectedId) ?? null;
  const perSession = selected && selected.sessions > 0 ? selected.price / selected.sessions : 0;

  return (
    <section className="rounded-3xl border border-lux-line/10 bg-lux-ivory/[0.04] p-6 shadow-lux backdrop-blur-xl md:p-7">
      <p className="text-[11px] uppercase tracking-[0.3em] text-lux-mist">Personal training</p>
      <h2 className="mt-3 text-2xl font-light tracking-wide text-lux-ivory">Top up your sessions</h2>

      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-lux-line/10 bg-lux-obsidian/40 p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-lux-gold/15 text-lux-gold">
          <UserRound className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium tracking-wide text-lux-ivory">
            {trainerName ?? 'Trainer assigned at the desk'}
          </p>
          <p className="text-xs tracking-wide text-lux-mist">{remaining} session{remaining === 1 ? '' : 's'} left</p>
        </div>
      </div>

      {options.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-lux-line/15 p-6 text-center text-sm tracking-wide text-lux-mist">
          No training packages are published for your club right now. The front desk can set one up for you.
        </p>
      ) : (
        <>
          <p className="mt-7 text-xs uppercase tracking-[0.25em] text-lux-mist">Choose a bundle</p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {options.map((option) => {
              const active = option.id === selectedId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedId(option.id)}
                  aria-pressed={active}
                  className={`min-h-[44px] cursor-pointer rounded-2xl border px-5 py-2.5 text-sm tracking-wide transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-lux-gold ${
                    active
                      ? 'border-lux-gold/60 bg-lux-gold/15 text-lux-ivory'
                      : 'border-lux-line/15 text-lux-mist hover:border-lux-gold/35 hover:text-lux-ivory'
                  }`}
                >
                  +{option.sessions}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="mt-7 rounded-2xl border border-lux-line/10 bg-lux-obsidian/40 p-5">
              <p className="text-sm font-medium tracking-wide text-lux-ivory">{selected.name}</p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <span className="text-3xl font-medium tracking-tight text-lux-ivory">{formatINR(selected.price)}</span>
                <span className="pb-1 text-xs tracking-wide text-lux-mist">
                  {formatINR(perSession)} / session
                </span>
              </div>
              <p className="mt-2 text-xs tracking-wide text-lux-mist">
                Valid for {selected.validityDays} days from activation
              </p>
              <Button
                onClick={() => onSelect(selected)}
                className="mt-6 h-12 w-full cursor-pointer rounded-2xl bg-gradient-gold text-sm font-medium tracking-wide text-lux-obsidian transition-all duration-200 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-lux-gold"
              >
                Add {selected.sessions} sessions
                <ArrowUpRight className="ml-1.5 h-4 w-4" aria-hidden />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default PtTopUpPanel;
