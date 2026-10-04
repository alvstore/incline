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
    <section className="rounded-2xl bg-white p-6 shadow-lg shadow-slate-200/50 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/10 md:p-7">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Personal training</p>
      <h2 className="mt-2 text-xl font-bold text-slate-900">Top up your sessions</h2>

      <div className="mt-5 flex items-center gap-3 rounded-xl bg-slate-50 p-4">
        <span className="rounded-full bg-indigo-50 p-2.5 text-indigo-600">
          <UserRound className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{trainerName ?? 'Trainer assigned at the desk'}</p>
          <p className="text-xs text-slate-500">{remaining} session{remaining === 1 ? '' : 's'} left</p>
        </div>
      </div>

      {options.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">
          No training packages are published for your club right now. The front desk can set one up for you.
        </p>
      ) : (
        <>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">Choose a bundle</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((option) => {
              const active = option.id === selectedId;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedId(option.id)}
                  aria-pressed={active}
                  className={`min-h-[44px] cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30' : 'bg-slate-100 text-slate-700 hover:bg-indigo-50 hover:text-indigo-700'
                  }`}
                >
                  +{option.sessions}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="mt-6 rounded-xl bg-slate-50 p-5">
              <p className="text-sm font-semibold text-slate-900">{selected.name}</p>
              <div className="mt-2 flex items-end justify-between gap-3">
                <span className="text-3xl font-bold text-slate-900">{formatINR(selected.price)}</span>
                <span className="pb-1 text-xs text-slate-500">{formatINR(perSession)} / session</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">Valid for {selected.validityDays} days from activation</p>
              <Button
                onClick={() => onSelect(selected)}
                className="mt-5 h-12 w-full cursor-pointer rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-sm font-semibold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-indigo-500"
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
